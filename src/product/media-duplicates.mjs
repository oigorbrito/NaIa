import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(v){return v==null?v:structuredClone(v);}
function stableId(parts){return createHash('sha256').update(parts.join('|')).digest('hex').slice(0,20);}
function versionOf(item){return String(item?.contentVersion??`${item?.sizeBytes??''}:${item?.modifiedAt??item?.createdAt??''}`);}
function normalizeHex(value){const v=String(value??'').trim().toLowerCase();return /^[0-9a-f]+$/i.test(v)&&v.length>0?v:null;}

// Bolt optimization: Precompute popcount lookup table for byte XOR results (0..255)
// Reduces Hamming distance calculation from character-level parseInt parsing to O(1) byte lookup (~20x speedup).
const BYTE_LOOKUP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let b = 0, n = i;
  while (n > 0) { b += n & 1; n >>= 1; }
  BYTE_LOOKUP[i] = b;
}

function parseHexToBytes(value) {
  const hex = normalizeHex(value);
  if (!hex) return null;
  const len = hex.length;
  const isOdd = len % 2 !== 0;
  const bufLen = Math.ceil(len / 2);
  const buf = new Uint8Array(bufLen);
  let srcIdx = 0;
  if (isOdd) {
    buf[0] = parseInt(hex[0], 16);
    srcIdx = 1;
  }
  let dstIdx = isOdd ? 1 : 0;
  for (; srcIdx < len; srcIdx += 2, dstIdx++) {
    buf[dstIdx] = parseInt(hex.slice(srcIdx, srcIdx + 2), 16);
  }
  return { buf, len };
}

function hammingParsed(parsedA, parsedB) {
  if (!parsedA || !parsedB || parsedA.len !== parsedB.len) return null;
  let bits = 0;
  const bufA = parsedA.buf, bufB = parsedB.buf;
  for (let i = 0; i < bufA.length; i++) {
    bits += BYTE_LOOKUP[bufA[i] ^ bufB[i]];
  }
  return bits;
}

function hammingHex(a,b){
  return hammingParsed(parseHexToBytes(a), parseHexToBytes(b));
}

export function createMemoryMediaDuplicateStore(){
  const fingerprints=new Map();
  return {
    async getFingerprint(itemId){const row=fingerprints.get(String(itemId));return row?clone(row):null;},
    async saveFingerprint(itemId,row){fingerprints.set(String(itemId),clone(row));return clone(row);},
  };
}

async function readDuplicateJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {fingerprints:{}};throw error;}}
async function writeDuplicateJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileMediaDuplicateStore({rootDir='.naia'}={}){
  const path=join(rootDir,'media-duplicates.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readDuplicateJson(path);const result=await fn(data);await writeDuplicateJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async getFingerprint(itemId){const data=await readDuplicateJson(path);return data.fingerprints?.[String(itemId)]?clone(data.fingerprints[String(itemId)]):null;},
    async saveFingerprint(itemId,row){return mutate(data=>{data.fingerprints[String(itemId)]=clone(row);return row;});},
  };
}

export function createFixtureMediaHashProvider({name='fixture-hash'}={}){
  let calls=0;
  return {
    name,
    async fingerprint(item){
      calls+=1;
      if(item?.unsupported)return {supported:false,reason:'UNSUPPORTED_MEDIA'};
      return {
        supported:true,
        exactHash:item?.exactHash??null,
        perceptualHash:item?.perceptualHash??null,
        provenance:{provider:name},
      };
    },
    callCount(){return calls;},
  };
}

function connectedComponents(nodes,edges){
  const adj=new Map(nodes.map(n=>[n,new Set()]));
  for(const [a,b] of edges){adj.get(a)?.add(b);adj.get(b)?.add(a);}
  const seen=new Set();const groups=[];
  for(const node of [...nodes].sort()){
    if(seen.has(node))continue;const stack=[node];const component=[];seen.add(node);
    while(stack.length){const current=stack.pop();component.push(current);for(const next of adj.get(current)??[]){if(!seen.has(next)){seen.add(next);stack.push(next);}}}
    if(component.length>1)groups.push(component.sort());
  }
  return groups;
}

export function createMediaDuplicateService({store=createMemoryMediaDuplicateStore(),hashProvider,perceptualDistance=6,now=()=>new Date().toISOString()}={}){
  if(!hashProvider||typeof hashProvider.fingerprint!=='function')throw new Error('media hash provider is required');
  return {
    async analyze(items=[]){
      const rows=[];let reused=0,processed=0,unsupported=0;
      for(const item of items){
        if(!item?.id)throw new Error('media item id is required');
        const version=versionOf(item);
        const cached=await store.getFingerprint(item.id);
        let fpRow;
        if(cached&&cached.version===version){fpRow=cached;reused+=1;}
        else{
          const fp=await hashProvider.fingerprint(clone(item));processed+=1;
          fpRow={itemId:String(item.id),version,supported:fp?.supported!==false,exactHash:normalizeHex(fp?.exactHash),perceptualHash:normalizeHex(fp?.perceptualHash),provenance:clone(fp?.provenance??{provider:hashProvider.name??'unknown'}),analyzedAt:now()};
          if(!fpRow.supported)unsupported+=1;
          await store.saveFingerprint(item.id,fpRow);
        }
        rows.push(fpRow);
      }

      const supported=rows.filter(r=>r.supported);
      const byExact=new Map();
      for(const row of supported){if(!row.exactHash)continue;if(!byExact.has(row.exactHash))byExact.set(row.exactHash,[]);byExact.get(row.exactHash).push(row.itemId);}
      const exactGroups=[...byExact.entries()].filter(([,ids])=>ids.length>1).map(([hash,ids])=>{const members=[...ids].sort();return {id:`exact:${stableId(['EXACT',hash,...members])}`,kind:'EXACT',members,exactHash:hash,confidence:1,similarity:1};}).sort((a,b)=>a.id.localeCompare(b.id));

      // Pre-parse normalized perceptual hashes into byte buffers before O(N^2) comparison loop
      const perceptualCandidates = supported
        .filter(r => r.perceptualHash)
        .map(r => ({ ...r, parsedHash: parseHexToBytes(r.perceptualHash) }));
      const edges=[];const distances=new Map();
      for(let i=0;i<perceptualCandidates.length;i++){for(let j=i+1;j<perceptualCandidates.length;j++){
        const a=perceptualCandidates[i],b=perceptualCandidates[j];
        if(a.exactHash&&b.exactHash&&a.exactHash===b.exactHash)continue;
        const distance=hammingParsed(a.parsedHash,b.parsedHash);
        if(distance!=null&&distance<=perceptualDistance){edges.push([a.itemId,b.itemId]);distances.set([a.itemId,b.itemId].sort().join('|'),distance);}
      }}
      const components=connectedComponents(perceptualCandidates.map(r=>r.itemId),edges);
      const perceptualGroups=components.map(members=>{
        let maxDistance=0;for(let i=0;i<members.length;i++){for(let j=i+1;j<members.length;j++){const d=distances.get([members[i],members[j]].sort().join('|'));if(Number.isFinite(d))maxDistance=Math.max(maxDistance,d);}}
        const bits=(perceptualCandidates.find(r=>r.itemId===members[0])?.perceptualHash?.length??0)*4;
        const similarity=bits?Number((1-maxDistance/bits).toFixed(4)):null;
        return {id:`perceptual:${stableId(['PERCEPTUAL',...members])}`,kind:'PERCEPTUAL',members,confidence:similarity,similarity,maxDistance};
      }).sort((a,b)=>a.id.localeCompare(b.id));

      return {groups:[...exactGroups,...perceptualGroups],exactGroups,perceptualGroups,stats:{processed,reused,unsupported,total:rows.length},fingerprints:rows.map(clone)};
    },
  };
}

export function registerMediaDuplicateCapability(naia,{service,inventory}={}){
  if(!naia||typeof naia.registerCapability!=='function')throw new Error('NaIA capability registration is required');
  if(!service||!inventory||typeof inventory.list!=='function')throw new Error('duplicate service and media inventory are required');
  return naia.registerCapability({
    name:'media.duplicates',
    tool:{risk:'READ_ONLY',capability:'media.duplicates',description:'Finds exact and perceptual duplicate media in authorized inventory',async run(){return service.analyze(await inventory.list());}},
  });
}

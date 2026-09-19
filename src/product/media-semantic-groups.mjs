import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(v){return v==null?v:structuredClone(v);}
function stableId(parts){return createHash('sha256').update(parts.join('|')).digest('hex').slice(0,20);}
function itemVersion(item){return String(item?.contentVersion??`${item?.sizeBytes??''}:${item?.modifiedAt??item?.createdAt??''}`);}
function normalizeVector(value){const v=(value??[]).map(Number);if(!v.length||v.some(x=>!Number.isFinite(x)))return null;return v;}
function cosine(a,b){
  if(!a||!b||a.length!==b.length)return null;
  let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  if(!aa||!bb)return null;return dot/(Math.sqrt(aa)*Math.sqrt(bb));
}

export function createMemorySemanticEmbeddingStore(){
  const rows=new Map();
  return {
    async get(itemId){const row=rows.get(String(itemId));return row?clone(row):null;},
    async save(itemId,row){rows.set(String(itemId),clone(row));return clone(row);},
  };
}

async function readSemanticJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {embeddings:{}};throw error;}}
async function writeSemanticJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileSemanticEmbeddingStore({rootDir='.naia'}={}){
  const path=join(rootDir,'media-semantic-embeddings.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readSemanticJson(path);const result=await fn(data);await writeSemanticJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async get(itemId){const data=await readSemanticJson(path);return data.embeddings?.[String(itemId)]?clone(data.embeddings[String(itemId)]):null;},
    async save(itemId,row){return mutate(data=>{data.embeddings[String(itemId)]=clone(row);return row;});},
  };
}

export function createFixtureEmbeddingProvider({name='fixture-embedding',model='fixture-vision',version='1',fail=null}={}){
  let calls=0;
  return {
    name,model,version,
    async embed(item){
      calls+=1;
      if(fail){const e=new Error(fail.message??'embedding unavailable');e.code=fail.code??'MODEL_UNAVAILABLE';e.retryable=Boolean(fail.retryable);throw e;}
      if(item?.unsupported)return {supported:false,reason:'UNSUPPORTED_MEDIA',model,version};
      return {supported:true,vector:clone(item?.embedding??[]),model,version};
    },
    callCount(){return calls;},
  };
}

function completeLinkGroups(rows,threshold){
  const sorted=[...rows].sort((a,b)=>a.itemId.localeCompare(b.itemId));
  const groups=[];
  for(const row of sorted){
    let placed=false;
    for(const group of groups){
      const compatible=group.every(member=>{
        const sim=cosine(row.vector,member.vector);
        return sim!=null&&sim>=threshold;
      });
      if(compatible){group.push(row);placed=true;break;}
    }
    if(!placed)groups.push([row]);
  }
  return groups.filter(group=>group.length>1);
}

export function createSemanticMediaGroupingService({store=createMemorySemanticEmbeddingStore(),embeddingProvider,threshold=0.9,now=()=>new Date().toISOString()}={}){
  if(!embeddingProvider||typeof embeddingProvider.embed!=='function')throw new Error('embedding provider is required');
  if(!Number.isFinite(Number(threshold))||threshold<-1||threshold>1)throw new Error('similarity threshold must be between -1 and 1');
  return {
    async group(items=[]){
      const model=String(embeddingProvider.model??embeddingProvider.name??'unknown');
      const version=String(embeddingProvider.version??'unknown');
      const rows=[];const errors=[];let processed=0,reused=0,unsupported=0;
      for(const item of items){
        if(!item?.id)throw new Error('media item id is required');
        const cacheKey={itemVersion:itemVersion(item),model,version};
        const cached=await store.get(item.id);
        if(cached&&cached.itemVersion===cacheKey.itemVersion&&cached.model===model&&cached.version===version){rows.push(cached);reused+=1;continue;}
        try{
          const result=await embeddingProvider.embed(clone(item));processed+=1;
          const vector=normalizeVector(result?.vector);
          const row={itemId:String(item.id),itemVersion:cacheKey.itemVersion,model:String(result?.model??model),version:String(result?.version??version),supported:result?.supported!==false&&Boolean(vector),vector,reason:result?.supported===false?result?.reason??'UNSUPPORTED_MEDIA':(!vector?'INVALID_EMBEDDING':null),embeddedAt:now()};
          if(!row.supported)unsupported+=1;
          await store.save(item.id,row);rows.push(row);
        }catch(error){errors.push({itemId:String(item.id),code:error?.code??'EMBEDDING_FAILED',retryable:Boolean(error?.retryable)});}
      }
      const usable=rows.filter(r=>r.supported&&r.vector);
      const groups=completeLinkGroups(usable,Number(threshold)).map(group=>{
        const members=group.map(row=>row.itemId).sort();
        let minSimilarity=1;
        for(let i=0;i<group.length;i++){for(let j=i+1;j<group.length;j++){const sim=cosine(group[i].vector,group[j].vector);if(Number.isFinite(sim))minSimilarity=Math.min(minSimilarity,sim);}}
        return {id:`semantic:${stableId([model,version,String(threshold),...members])}`,kind:'SEMANTIC',members,model,version,threshold:Number(threshold),minSimilarity:Number(minSimilarity.toFixed(6))};
      }).sort((a,b)=>a.id.localeCompare(b.id));
      const status=errors.length===items.length&&items.length?'UNAVAILABLE':errors.length?'DEGRADED':'OK';
      return {status,groups,embeddings:rows.map(clone),errors,stats:{processed,reused,unsupported,total:items.length},provenance:{model,version,threshold:Number(threshold)}};
    },
  };
}

export function registerSemanticMediaGroupingCapability(naia,{service,inventory}={}){
  if(!naia||typeof naia.registerCapability!=='function')throw new Error('NaIA capability registration is required');
  if(!service||!inventory||typeof inventory.list!=='function')throw new Error('semantic grouping service and media inventory are required');
  return naia.registerCapability({
    name:'media.semanticGroups',
    tool:{risk:'READ_ONLY',capability:'media.semanticGroups',description:'Groups authorized media by semantic embedding similarity',async run(){return service.group(await inventory.list());}},
  });
}

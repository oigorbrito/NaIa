import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(value){ return value==null?value:structuredClone(value); }
function totalOf(row){ return Number((Number(row.price??0)+Number(row.fees??0)).toFixed(2)); }
function semanticKey(row){ return createHash('sha256').update(JSON.stringify({targetId:row.targetId,offerId:row.offerId,source:row.source,currency:row.currency,price:row.price,fees:row.fees,availability:row.availability,comparisonKey:row.comparisonKey,attributes:row.attributes})).digest('hex'); }
function median(values){ const sorted=[...values].sort((a,b)=>a-b); const n=sorted.length; if(!n) return null; return n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2; }
function attrsMatch(attributes={},constraints={}){ return Object.entries(constraints??{}).every(([k,v])=>attributes?.[k]===v); }

export function createMemoryDealStore(){
  const observations=[]; const keys=new Set();
  return {
    async append(row){ const key=semanticKey(row); if(keys.has(key)) return {duplicate:true,observation:null}; keys.add(key); observations.push(clone(row)); return {duplicate:false,observation:clone(row)}; },
    async list(targetId){ return observations.filter((row)=>row.targetId===targetId).map(clone); },
  };
}

async function readDealJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {observations:[],keys:{}};throw error;}}
async function writeDealJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileDealStore({rootDir='.naia'}={}){
  const path=join(rootDir,'deals.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readDealJson(path);const result=await fn(data);await writeDealJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async append(row){return mutate(data=>{const key=semanticKey(row);if(data.keys[key])return {duplicate:true,observation:null};data.keys[key]=true;data.observations.push(clone(row));return {duplicate:false,observation:row};});},
    async list(targetId){const data=await readDealJson(path);return (data.observations??[]).filter(row=>row.targetId===targetId).map(clone);},
  };
}

export function createDealService({store=createMemoryDealStore(),idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  return {
    async record({targetId,offerId,source='unknown',observedAt=now(),price,fees=0,currency='BRL',availability=true,comparisonKey='default',attributes={},provenance={}}){
      if(!targetId||!offerId) throw new Error('targetId and offerId are required');
      const p=Number(price), f=Number(fees);
      if(!Number.isFinite(p)||p<0||!Number.isFinite(f)||f<0) throw new Error('price and fees must be finite non-negative numbers');
      const row={id:idFactory(),targetId:String(targetId),offerId:String(offerId),source:String(source),observedAt:String(observedAt),price:p,fees:f,total:Number((p+f).toFixed(2)),currency:String(currency).toUpperCase(),availability:Boolean(availability),comparisonKey:String(comparisonKey),attributes:clone(attributes),provenance:clone(provenance)};
      const saved=await store.append(row);
      return saved.duplicate?{duplicate:true,observation:null}:{duplicate:false,observation:row};
    },

    async evaluate(targetId,{offerId,threshold=null,materialBelowPct=10,referenceWindowMs=30*24*60*60*1000,minHistory=2,maxCurrentAgeMs=6*60*60*1000,asOf=now()}={}){
      const rows=(await store.list(targetId)).sort((a,b)=>String(a.observedAt).localeCompare(String(b.observedAt)));
      const candidates=rows.filter((row)=>!offerId||row.offerId===String(offerId));
      const current=candidates.at(-1)??null;
      if(!current) return {status:'INSUFFICIENT_EVIDENCE',signals:['INSUFFICIENT_EVIDENCE'],current:null,reference:{historyCount:0}};
      const asOfMs=new Date(asOf).getTime(), currentMs=new Date(current.observedAt).getTime();
      if(!Number.isFinite(asOfMs)||!Number.isFinite(currentMs)) throw new Error('invalid evaluation timestamp');
      if(asOfMs-currentMs>maxCurrentAgeMs) return {status:'STALE',signals:['STALE'],current:clone(current),reference:{historyCount:0}};
      const windowStart=currentMs-referenceWindowMs;
      const history=rows.filter((row)=>row.id!==current.id&&new Date(row.observedAt).getTime()>=windowStart&&new Date(row.observedAt).getTime()<currentMs&&row.currency===current.currency&&row.comparisonKey===current.comparisonKey&&row.availability);
      const totals=history.map(totalOf);
      const refMedian=median(totals);
      const refMin=totals.length?Math.min(...totals):null;
      const signals=[];
      if(threshold!=null&&current.total<=Number(threshold)) signals.push('THRESHOLD_HIT');
      const sufficient=history.length>=Number(minHistory);
      if(sufficient){
        if(refMin!=null&&current.total<refMin) signals.push('NEW_LOW');
        if(refMedian!=null&&refMedian>0){
          const below=((refMedian-current.total)/refMedian)*100;
          if(below>=Number(materialBelowPct)) signals.push('MATERIALLY_BELOW_REFERENCE');
        }
      }else if(!signals.length){
        signals.push('INSUFFICIENT_EVIDENCE');
      }
      if(sufficient&&!signals.length) signals.push('NO_DEAL');
      const status=signals.includes('INSUFFICIENT_EVIDENCE')?'INSUFFICIENT_EVIDENCE':'OK';
      return {
        status,signals,current:clone(current),
        reference:{historyCount:history.length,windowStart:new Date(windowStart).toISOString(),medianTotal:refMedian==null?null:Number(refMedian.toFixed(2)),minTotal:refMin,comparisonKey:current.comparisonKey,currency:current.currency},
        confidence:sufficient?'DERIVED_FROM_HISTORY':(signals.includes('THRESHOLD_HIT')?'OBSERVED_THRESHOLD':'LOW'),
      };
    },

    async rank(targetId,{constraints={},asOf=now(),maxAgeMs=6*60*60*1000}={}){
      const rows=await store.list(targetId);
      const latest=new Map();
      for(const row of rows){ const prev=latest.get(row.offerId); if(!prev||String(row.observedAt)>String(prev.observedAt)) latest.set(row.offerId,row); }
      const asOfMs=new Date(asOf).getTime();
      return [...latest.values()].map((row)=>{
        const age=asOfMs-new Date(row.observedAt).getTime();
        const stale=age>maxAgeMs;
        const constraintsMatch=attrsMatch(row.attributes,constraints);
        return {...clone(row),stale,constraintsMatch,rankingReasons:[row.availability?'AVAILABLE':'UNAVAILABLE',constraintsMatch?'CONSTRAINTS_MATCH':'CONSTRAINTS_MISMATCH',`TOTAL_${row.total}`]};
      }).sort((a,b)=>{
        if(a.stale!==b.stale) return a.stale?1:-1;
        if(a.availability!==b.availability) return a.availability? -1:1;
        if(a.constraintsMatch!==b.constraintsMatch) return a.constraintsMatch?-1:1;
        return a.total-b.total||a.offerId.localeCompare(b.offerId);
      });
    },

    async history(targetId){ return store.list(targetId); },
  };
}

export function dealToWatchObservation(result,{source='deal-detection'}={}){
  const signal=(result?.signals??[]).find((item)=>['NEW_LOW','THRESHOLD_HIT','MATERIALLY_BELOW_REFERENCE'].includes(item))??result?.signals?.[0]??'NO_DEAL';
  return {source,state:signal,available:signal!=='NO_DEAL'&&signal!=='INSUFFICIENT_EVIDENCE'&&signal!=='STALE',value:result?.current?.total??null,observedAt:result?.current?.observedAt??null,provenance:{reference:clone(result?.reference??null),confidence:result?.confidence??null}};
}

export function dealToRadarSignal(result,{targetId=null,title=null,source='deal-detection'}={}){
  const positive=(result?.signals??[]).find((item)=>['NEW_LOW','THRESHOLD_HIT','MATERIALLY_BELOW_REFERENCE'].includes(item))??null;
  if(!positive)return null;
  const current=result?.current??{};
  return {
    id:`deal:${targetId??current.targetId??current.offerId??'unknown'}:${current.offerId??'offer'}:${current.observedAt??'unknown'}`,
    source,
    topicKey:`deal:${targetId??current.targetId??current.offerId??'unknown'}`,
    type:'ALERT',
    title:title??`Deal opportunity: ${targetId??current.targetId??current.offerId??'offer'}`,
    summary:`${positive} at ${current.total??'unknown'} ${current.currency??''}`.trim(),
    occurredAt:current.observedAt??null,
    action:null,
    metadata:{signal:positive,offerId:current.offerId??null,total:current.total??null,currency:current.currency??null,reference:clone(result?.reference??null),confidence:result?.confidence??null,provenance:clone(current.provenance??{})},
  };
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildRadarDigest } from './radar.mjs';

function clone(v){return v==null?v:structuredClone(v);}

export function composeBriefingPayload(digest,{language='pt-BR',maxTopics=5,length='SHORT'}={}){
  const topics=(digest?.topics??[]).slice(0,Math.max(1,Number(maxTopics)||5));
  const sentences=[]; const references=[];
  for(const topic of topics){
    const headline=topic.title||topic.topicKey;
    const item=topic.items?.[0];
    const detail=item?.summary||item?.title||'';
    sentences.push(detail?`${headline}: ${detail}`:headline);
    references.push({topicKey:topic.topicKey,itemIds:(topic.items??[]).map((row)=>row.id),sources:clone(topic.sources??[]),actions:clone(topic.actions??[])});
  }
  const transcript=sentences.length?sentences.join('. ')+'.':'Nenhuma atualização prioritária.';
  return {language,length,generatedAt:digest?.generatedAt??null,transcript,references,topicCount:topics.length};
}

export function createFixtureTtsProvider({name='fixture-tts',fail=null}={}){
  return {
    name,
    async synthesize({text,language}){
      if(fail){const e=new Error(fail.message??'tts failed');e.code=fail.code??'TTS_FAILED';e.retryable=Boolean(fail.retryable);throw e;}
      return {audioRef:`audio://${name}/${Buffer.from(text).toString('base64url').slice(0,16)}`,language,durationSeconds:Math.max(1,Math.ceil(text.length/15))};
    },
  };
}

export function createMemoryBriefingStore(){
  const deliveries=new Map();
  return {
    async get(key){const row=deliveries.get(key);return row?clone(row):null;},
    async save(key,row){deliveries.set(key,clone(row));return clone(row);},
  };
}

async function readBriefingJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {deliveries:{}};throw error;}}
async function writeBriefingJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileBriefingStore({rootDir='.naia'}={}){
  const path=join(rootDir,'daily-briefings.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readBriefingJson(path);const result=await fn(data);await writeBriefingJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async get(key){const data=await readBriefingJson(path);return data.deliveries?.[String(key)]?clone(data.deliveries[String(key)]):null;},
    async save(key,row){return mutate(data=>{data.deliveries[key]=clone(row);return row;});},
  };
}

export function createDailyBriefingService({tts,preferenceStore=null,store=createMemoryBriefingStore(),now=()=>new Date().toISOString(),idFactory=randomUUID}={}){
  if(!tts||typeof tts.synthesize!=='function') throw new Error('TTS provider is required');
  return {
    async generate({userId,signals,deliveryKey,preferences={}}){
      if(!userId||!deliveryKey) throw new Error('userId and deliveryKey are required');
      const key=`${userId}:${deliveryKey}`;
      const prior=await store.get(key); if(prior) return {duplicate:true,...prior};
      const persisted=preferenceStore?.get?await preferenceStore.get(userId):{disabledSources:[]};
      const disabledSources=[...new Set([...(persisted?.disabledSources??[]),...(preferences.disabledSources??[])])];
      const digest=buildRadarDigest(signals,{disabledSources,now:now()});
      const payload=composeBriefingPayload(digest,{language:preferences.language??'pt-BR',maxTopics:preferences.maxTopics??5,length:preferences.length??'SHORT'});
      let audio=null,status='READY',error=null;
      try{audio=await tts.synthesize({text:payload.transcript,language:payload.language});}
      catch(e){status='DEGRADED_TEXT_ONLY';error={code:e?.code??'TTS_FAILED',retryable:Boolean(e?.retryable)};}
      const row={id:idFactory(),userId,deliveryKey,status,payload,audio:clone(audio),error,createdAt:now()};
      await store.save(key,row); return {duplicate:false,...clone(row)};
    },
  };
}

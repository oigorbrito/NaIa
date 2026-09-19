import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createRadarPreferenceStore } from '../../src/product/radar.mjs';
import { composeBriefingPayload, createDailyBriefingService, createFileBriefingStore, createFixtureTtsProvider } from '../../src/product/daily-briefing.mjs';

const SIGNALS=[
  {id:'cal-1',source:'calendar',topicKey:'project',type:'DEADLINE',title:'Project',summary:'Deadline tomorrow',occurredAt:'2026-09-19T13:00:00Z',dueAt:'2026-09-20T10:00:00Z',action:{tool:'calendar.update',risk:'EXTERNAL_WRITE',requiresApproval:true}},
  {id:'mail-1',source:'email',topicKey:'client',type:'PENDING_REPLY',title:'Client',summary:'Reply needed',occurredAt:'2026-09-19T13:30:00Z',action:{tool:'email.send',risk:'EXTERNAL_WRITE',requiresApproval:true}},
];

test('fixed Radar digest produces deterministic briefing payload with follow-up references',()=>{
  const digest={generatedAt:'2026-09-19T14:00:00Z',topics:[
    {topicKey:'project',title:'Project',sources:['calendar'],items:[SIGNALS[0]],actions:[SIGNALS[0].action]},
    {topicKey:'client',title:'Client',sources:['email'],items:[SIGNALS[1]],actions:[SIGNALS[1].action]},
  ]};
  const payload=composeBriefingPayload(digest,{language:'pt-BR',maxTopics:2});
  assert.equal(payload.transcript,'Project: Deadline tomorrow. Client: Reply needed.');
  assert.deepEqual(payload.references[0].itemIds,['cal-1']);
  assert.equal(payload.references[1].actions[0].tool,'email.send');
});

test('same payload can render through replaceable TTS adapter',async()=>{
  const service=createDailyBriefingService({tts:createFixtureTtsProvider({name:'tts-a'}),now:()=> '2026-09-19T14:00:00Z',idFactory:()=> 'brief-1'});
  const result=await service.generate({userId:'u1',signals:SIGNALS,deliveryKey:'2026-09-19'});
  assert.equal(result.status,'READY');
  assert.ok(result.audio.audioRef.startsWith('audio://tts-a/'));
  assert.ok(result.payload.transcript.includes('Deadline tomorrow'));
});

test('source opt-out removes source from subsequent briefing',async()=>{
  const prefs=createRadarPreferenceStore();
  await prefs.set('u1',{disabledSources:['email']});
  const service=createDailyBriefingService({tts:createFixtureTtsProvider(),preferenceStore:prefs,now:()=> '2026-09-19T14:00:00Z',idFactory:()=> 'brief-1'});
  const result=await service.generate({userId:'u1',signals:SIGNALS,deliveryKey:'d1'});
  assert.equal(result.payload.references.some((r)=>r.sources.includes('email')),false);
  assert.equal(result.payload.transcript.includes('Client'),false);
});

test('TTS failure preserves textual briefing in explicit degraded state',async()=>{
  const service=createDailyBriefingService({tts:createFixtureTtsProvider({fail:{code:'TTS_DOWN',message:'down',retryable:true}}),now:()=> '2026-09-19T14:00:00Z',idFactory:()=> 'brief-1'});
  const result=await service.generate({userId:'u1',signals:SIGNALS,deliveryKey:'d1'});
  assert.equal(result.status,'DEGRADED_TEXT_ONLY');
  assert.ok(result.payload.transcript.length>0);
  assert.equal(result.audio,null);
  assert.equal(result.error.code,'TTS_DOWN');
});

test('duplicate scheduled delivery is idempotent',async()=>{
  const service=createDailyBriefingService({tts:createFixtureTtsProvider(),now:()=> '2026-09-19T14:00:00Z',idFactory:()=> 'brief-1'});
  const first=await service.generate({userId:'u1',signals:SIGNALS,deliveryKey:'daily:2026-09-19'});
  const duplicate=await service.generate({userId:'u1',signals:SIGNALS,deliveryKey:'daily:2026-09-19'});
  assert.equal(first.duplicate,false);
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.id,first.id);
});

test('briefing mention of external-write action never executes it',async()=>{
  const signals=[{...SIGNALS[0],action:{tool:'calendar.update',risk:'EXTERNAL_WRITE',requiresApproval:true,input:{eventId:'e1'}}}];
  const service=createDailyBriefingService({tts:createFixtureTtsProvider(),now:()=> '2026-09-19T14:00:00Z',idFactory:()=> 'brief-1'});
  const result=await service.generate({userId:'u1',signals,deliveryKey:'d1'});
  assert.equal(result.payload.references[0].actions[0].requiresApproval,true);
  assert.equal(typeof result.payload.references[0].actions[0].run,'undefined');
});

test('scheduled delivery idempotency survives service restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-briefing-'));
  try{
    const first=createDailyBriefingService({tts:createFixtureTtsProvider(),store:createFileBriefingStore({rootDir:dir}),now:()=> '2026-09-19T14:00:00Z',idFactory:()=> 'brief-1'});
    const generated=await first.generate({userId:'u1',signals:SIGNALS,deliveryKey:'daily:2026-09-19'});
    assert.equal(generated.duplicate,false);
    const second=createDailyBriefingService({tts:createFixtureTtsProvider(),store:createFileBriefingStore({rootDir:dir}),now:()=> '2026-09-19T15:00:00Z'});
    const duplicate=await second.generate({userId:'u1',signals:SIGNALS,deliveryKey:'daily:2026-09-19'});
    assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.id,'brief-1');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('degraded text-only briefing survives restart and raw TTS error is not persisted',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-briefing-degraded-'));
  try{
    const store=createFileBriefingStore({rootDir:dir});
    const first=createDailyBriefingService({tts:createFixtureTtsProvider({fail:{code:'TTS_DOWN',message:'Bearer top-secret',retryable:true}}),store,now:()=> '2026-09-19T14:00:00Z',idFactory:()=> 'brief-1'});
    const generated=await first.generate({userId:'u1',signals:SIGNALS,deliveryKey:'d1'});
    assert.equal(generated.status,'DEGRADED_TEXT_ONLY');
    assert.ok(generated.payload.transcript.includes('Deadline tomorrow'));
    assert.deepEqual(generated.error,{code:'TTS_DOWN',retryable:true});
    const persisted=await readFile(store.path,'utf8');
    assert.equal(persisted.includes('top-secret'),false);
    const second=createDailyBriefingService({tts:createFixtureTtsProvider(),store:createFileBriefingStore({rootDir:dir})});
    const duplicate=await second.generate({userId:'u1',signals:[],deliveryKey:'d1'});
    assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.status,'DEGRADED_TEXT_ONLY');
    assert.ok(duplicate.payload.transcript.includes('Deadline tomorrow'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

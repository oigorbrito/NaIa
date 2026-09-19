import assert from 'node:assert/strict';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFixtureTranscriptionProvider, createVoiceInputService } from '../../src/product/voice-input.mjs';

function naia(){ return createNaiaService(createInMemoryPorts()); }

test('supported high-confidence voice creates same planned action as equivalent typed request',async()=>{
  const runtime=naia();
  let id=0;
  const transcriber=createFixtureTranscriptionProvider({result:{id:'t1',text:'uppercase: hello',language:'en',confidence:0.99}});
  const voice=createVoiceInputService({transcriber,naia:runtime,idFactory:()=> 'voice-'+(++id),now:()=> '2026-09-19T14:00:00Z'});
  const spoken=await voice.submit({audioRef:'audio://1',mimeType:'audio/ogg'});
  const typed=await runtime.pursue({title:'uppercase: hello'});
  assert.equal(spoken.status,'SUBMITTED');
  assert.equal(spoken.objective.plan.steps[1].action.tool,typed.plan.steps[1].action.tool);
  assert.deepEqual(spoken.objective.plan.steps[1].action.input,typed.plan.steps[1].action.input);
  assert.equal(spoken.objective.objective.status,'COMPLETED');
});

test('low-confidence transcript is held for confirmation and creates no objective',async()=>{
  const runtime=naia();
  const transcriber=createFixtureTranscriptionProvider({result:{id:'t2',text:'note release: send it',language:'en',confidence:0.4}});
  const voice=createVoiceInputService({transcriber,naia:runtime,minConfidence:0.75,idFactory:()=> 'voice-low'});
  const result=await voice.submit({audioRef:'audio://low',mimeType:'audio/ogg'});
  assert.equal(result.status,'NEEDS_TRANSCRIPT_CONFIRMATION');
  assert.equal(result.objective,null);
  assert.ok(result.submission.evidence.some((row)=>row.type==='VOICE_TRANSCRIPT_REVIEW_REQUIRED'));
  assert.equal((await runtime.history()).length,0);
});

test('user-confirmed or corrected low-confidence transcript enters normal runtime policy',async()=>{
  const runtime=naia();
  const transcriber=createFixtureTranscriptionProvider({result:{id:'t3',text:'not release send',language:'en',confidence:0.4}});
  const voice=createVoiceInputService({transcriber,naia:runtime,minConfidence:0.75,idFactory:()=> 'voice-review',now:()=> '2026-09-19T14:00:00Z'});
  const pending=await voice.submit({audioRef:'audio://review',mimeType:'audio/ogg'});
  const confirmed=await voice.confirmTranscript(pending.submission.id,{text:'note release: send it'});
  assert.equal(confirmed.status,'SUBMITTED');
  assert.equal(confirmed.objective.objective.status,'WAITING_APPROVAL');
  assert.equal(confirmed.objective.authorization.tool,'note.write');
  assert.equal(confirmed.submission.transcript.confirmedText,'note release: send it');
  assert.ok(confirmed.submission.evidence.some((row)=>row.type==='VOICE_OBJECTIVE_SUBMITTED'&&row.userConfirmed===true));
});

test('high-confidence external-write voice still requires normal runtime approval',async()=>{
  const runtime=naia();
  const transcriber=createFixtureTranscriptionProvider({result:{text:'note secure: voice write',language:'en',confidence:0.98}});
  const voice=createVoiceInputService({transcriber,naia:runtime,idFactory:()=> 'voice-write'});
  const result=await voice.submit({audioRef:'audio://write',mimeType:'audio/ogg'});
  assert.equal(result.objective.objective.status,'WAITING_APPROVAL');
  assert.equal(result.objective.authorization.tool,'note.write');
});

test('unsupported audio format fails explicitly without calling runtime',async()=>{
  const runtime=naia();
  const transcriber=createFixtureTranscriptionProvider({supportedMimeTypes:['audio/ogg'],result:{text:'uppercase: x',confidence:1}});
  const voice=createVoiceInputService({transcriber,naia:runtime});
  const result=await voice.submit({audioRef:'audio://x',mimeType:'audio/flac'});
  assert.equal(result.status,'UNSUPPORTED_AUDIO');
  assert.equal(result.error.code,'UNSUPPORTED_AUDIO');
  assert.equal((await runtime.history()).length,0);
});

test('transcription provider failure is explicit and preserves retryability',async()=>{
  const runtime=naia();
  const transcriber=createFixtureTranscriptionProvider({fail:{code:'RATE_LIMITED',message:'429',retryable:true}});
  const voice=createVoiceInputService({transcriber,naia:runtime});
  const result=await voice.submit({audioRef:'audio://x',mimeType:'audio/ogg'});
  assert.equal(result.status,'TRANSCRIPTION_FAILED');
  assert.equal(result.error.code,'RATE_LIMITED');
  assert.equal(result.error.retryable,true);
  assert.equal((await runtime.history()).length,0);
});

test('audio retention NONE keeps transcript provenance but not original audio reference or provider secret',async()=>{
  const runtime=naia();
  const transcriber=createFixtureTranscriptionProvider({name:'stt-provider',result:{id:'remote-1',text:'uppercase: x',language:'en',confidence:0.99}});
  transcriber.secret='do-not-store';
  const voice=createVoiceInputService({transcriber,naia:runtime,retentionPolicy:'NONE',idFactory:()=> 'voice-private'});
  const result=await voice.submit({audioRef:'audio://private',mimeType:'audio/ogg'});
  assert.equal(result.submission.audioRef,null);
  assert.equal(result.submission.transcript.provenance.provider,'stt-provider');
  assert.equal(result.submission.transcript.provenance.providerTranscriptId,'remote-1');
  assert.equal(JSON.stringify(result.submission).includes('do-not-store'),false);
});

test('invalid confirmation state fails closed',async()=>{
  const runtime=naia();
  const transcriber=createFixtureTranscriptionProvider({result:{text:'uppercase: x',confidence:0.99}});
  const voice=createVoiceInputService({transcriber,naia:runtime,idFactory:()=> 'voice-done'});
  const submitted=await voice.submit({audioRef:'audio://done',mimeType:'audio/ogg'});
  await assert.rejects(voice.confirmTranscript(submitted.submission.id),(error)=>error.code==='INVALID_VOICE_STATE');
});

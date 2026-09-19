import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRadarDigest, createRadarPreferenceStore } from '../../src/product/radar.mjs';

const NOW='2026-09-19T14:00:00Z';

test('Radar deterministically aggregates calendar plus email and prioritizes conflict/deadline',()=>{
  const digest=buildRadarDigest([
    {id:'cal-1',source:'calendar',topicKey:'project-a',type:'CONFLICT',title:'Project A',summary:'Two meetings overlap',occurredAt:'2026-09-19T13:00:00Z'},
    {id:'mail-1',source:'email',topicKey:'client-b',type:'PENDING_REPLY',title:'Client B',summary:'Reply pending',occurredAt:'2026-09-19T13:30:00Z'},
    {id:'cal-2',source:'calendar',topicKey:'deadline-c',type:'DEADLINE',title:'Deadline C',summary:'Due soon',occurredAt:'2026-09-19T12:00:00Z',dueAt:'2026-09-20T10:00:00Z'},
  ],{now:NOW});
  assert.equal(digest.totalTopics,3);
  assert.equal(digest.topics[0].topicKey,'project-a');
  assert.equal(digest.topics[1].topicKey,'deadline-c');
  assert.equal(digest.topics[2].topicKey,'client-b');
});

test('duplicate/related source events collapse into one topic while preserving source evidence',()=>{
  const digest=buildRadarDigest([
    {id:'cal-1',source:'calendar',topicKey:'project-a',title:'Project A',summary:'Meeting moved',occurredAt:'2026-09-19T13:00:00Z'},
    {id:'mail-1',source:'email',topicKey:'project-a',title:'Project A',summary:'Participant replied',occurredAt:'2026-09-19T13:10:00Z'},
    {id:'mail-1',source:'email',topicKey:'project-a',title:'Project A',summary:'duplicate delivery',occurredAt:'2026-09-19T13:11:00Z'},
  ],{now:NOW});
  assert.equal(digest.totalTopics,1);
  assert.deepEqual(digest.topics[0].sources,['calendar','email']);
  assert.equal(digest.topics[0].items.length,2);
});

test('stale items are suppressed',()=>{
  const digest=buildRadarDigest([
    {id:'old',source:'email',topicKey:'old',title:'Old',occurredAt:'2026-09-15T00:00:00Z'},
    {id:'fresh',source:'calendar',topicKey:'fresh',title:'Fresh',occurredAt:'2026-09-19T13:00:00Z'},
  ],{now:NOW,staleAfterMs:24*3600000});
  assert.deepEqual(digest.topics.map((t)=>t.topicKey),['fresh']);
});

test('source opt-out removes disabled source immediately',()=>{
  const digest=buildRadarDigest([
    {id:'mail',source:'email',topicKey:'x',title:'Mail',occurredAt:'2026-09-19T13:00:00Z'},
    {id:'cal',source:'calendar',topicKey:'y',title:'Cal',occurredAt:'2026-09-19T13:00:00Z'},
  ],{now:NOW,disabledSources:['email']});
  assert.deepEqual(digest.topics.map((t)=>t.sources),[['calendar']]);
});

test('external-write actions remain proposals with approval metadata and are never executed by Radar',()=>{
  const action={tool:'email.send',risk:'EXTERNAL_WRITE',requiresApproval:true,input:{to:'x@example.com'}};
  const digest=buildRadarDigest([{id:'mail',source:'email',topicKey:'reply',type:'PENDING_REPLY',title:'Reply',occurredAt:'2026-09-19T13:00:00Z',action}],{now:NOW});
  assert.equal(digest.topics[0].actions[0].tool,'email.send');
  assert.equal(digest.topics[0].actions[0].requiresApproval,true);
  assert.equal(typeof digest.topics[0].actions[0].run,'undefined');
});

test('Radar preference store persists disabled sources',async()=>{
  const store=createRadarPreferenceStore();
  await store.set('u1',{disabledSources:['email','files']});
  assert.deepEqual((await store.get('u1')).disabledSources,['email','files']);
});

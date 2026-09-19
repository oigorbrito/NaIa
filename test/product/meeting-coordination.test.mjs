import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import {
  createFileMeetingStore,
  createFixtureMeetingProvider,
  createMeetingService,
  normalizeMeetingIntent,
  proposeMeetingAction,
  registerMeetingCapability,
} from '../../src/product/meeting-coordination.mjs';

function fixture(options={}){
  let id=0;
  const provider=createFixtureMeetingProvider({
    name:'calendar',
    slots:[
      {id:'s1',start:'2026-09-20T10:00:00-03:00',end:'2026-09-20T10:30:00-03:00',timezone:'America/Sao_Paulo',location:'Room A',revision:'1',available:true},
      {id:'s2',start:'2026-09-20T11:00:00-03:00',end:'2026-09-20T11:30:00-03:00',timezone:'America/Sao_Paulo',location:'Room B',revision:'1',available:true},
      {id:'conflict',start:'2026-09-20T12:00:00-03:00',end:'2026-09-20T12:30:00-03:00',revision:'1',available:false},
    ],
    ...options,
  });
  const service=createMeetingService({providers:[provider],idFactory:()=> 'id-'+(++id),now:()=> '2026-09-19T14:00:00Z'});
  const naia=createNaiaService(createInMemoryPorts());
  registerMeetingCapability(naia,{service});
  return {provider,service,naia};
}

test('meeting intent normalizes participants duration and timezone',()=>{
  assert.deepEqual(normalizeMeetingIntent({title:'Sync',participants:['a@example.com','a@example.com','b@example.com'],durationMinutes:45,timezone:'America/Sao_Paulo'}),{
    title:'Sync',participants:['a@example.com','b@example.com'],durationMinutes:45,timezone:'America/Sao_Paulo',date:null,timeWindow:null,location:null,constraints:{},
  });
});

test('availability discovery returns feasible alternatives and excludes unavailable conflict slot',async()=>{
  const {service}=fixture();
  const result=await service.discover({title:'Sync',participants:['a@example.com'],durationMinutes:30,timezone:'America/Sao_Paulo'});
  assert.equal(result.options.length,2);
  assert.deepEqual(result.options.map((row)=>row.optionId),['s1','s2']);
  assert.ok(result.options.every((row)=>row.timezone==='America/Sao_Paulo'));
});

test('create flow separates slot confirmation from external-write approval',async()=>{
  const {service,naia}=fixture();
  const discovery=await service.discover({title:'Sync',participants:['a@example.com','b@example.com'],durationMinutes:30,timezone:'America/Sao_Paulo'});
  const action=await service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  const proposed=await proposeMeetingAction(naia,action);
  assert.equal(proposed.objective.status,'WAITING_CONFIRMATION');
  const confirmationId=proposed.confirmation.id;
  const approval=await naia.confirm(proposed.objective.id,confirmationId);
  assert.equal(approval.objective.status,'WAITING_APPROVAL');
  assert.equal(approval.authorization.tool,'meeting.commit');
  const completed=await naia.approve(proposed.objective.id,'meeting.commit');
  assert.equal(completed.objective.status,'COMPLETED');
  const savedAction=await service.getAction(action.id);
  assert.equal(savedAction.status,'COMPLETED');
});

test('material slot change after confirmation/approval fails closed as WAITING_REVIEW',async()=>{
  const {service,naia,provider}=fixture();
  const discovery=await service.discover({title:'Sync',participants:['a@example.com'],durationMinutes:30});
  const action=await service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  const proposed=await proposeMeetingAction(naia,action);
  await naia.confirm(proposed.objective.id,proposed.confirmation.id);
  provider.setSlotRevision('s1','2');
  const failed=await naia.approve(proposed.objective.id,'meeting.commit');
  assert.equal(failed.objective.status,'FAILED');
  assert.equal((await service.getAction(action.id)).status,'WAITING_REVIEW');
  assert.equal(await service.getMeeting('id-2'),null);
});

async function createMeeting(f){
  const discovery=await f.service.discover({title:'Sync',participants:['a@example.com','b@example.com'],durationMinutes:30,timezone:'America/Sao_Paulo'});
  const action=await f.service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  const proposed=await proposeMeetingAction(f.naia,action);
  await f.naia.confirm(proposed.objective.id,proposed.confirmation.id);
  await f.naia.approve(proposed.objective.id,'meeting.commit');
  const committed=await f.service.commit({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:'meeting:'+action.id});
  return {discovery,meeting:committed.meeting};
}

test('reschedule mutates same meeting identity after fresh confirmation and approval',async()=>{
  const f=fixture();
  const created=await createMeeting(f);
  const action=await f.service.prepareMutation({userId:'u1',meetingId:created.meeting.id,type:'RESCHEDULE',targetOption:created.discovery.options[1]});
  const proposed=await proposeMeetingAction(f.naia,action);
  await f.naia.confirm(proposed.objective.id,proposed.confirmation.id);
  await f.naia.approve(proposed.objective.id,'meeting.commit');
  const meeting=await f.service.getMeeting(created.meeting.id);
  assert.equal(meeting.id,created.meeting.id);
  assert.equal(meeting.start,'2026-09-20T11:00:00-03:00');
  assert.equal(meeting.state,'CONFIRMED');
});

test('cancel targets exact meeting and records participant notification',async()=>{
  const f=fixture();
  const created=await createMeeting(f);
  const action=await f.service.prepareMutation({userId:'u1',meetingId:created.meeting.id,type:'CANCEL'});
  const proposed=await proposeMeetingAction(f.naia,action);
  await f.naia.confirm(proposed.objective.id,proposed.confirmation.id);
  await f.naia.approve(proposed.objective.id,'meeting.commit');
  const meeting=await f.service.getMeeting(created.meeting.id);
  assert.equal(meeting.state,'CANCELLED');
  const notifications=await f.service.notifications(meeting.id);
  assert.ok(notifications.some((row)=>row.type==='CANCEL'));
});

test('duplicate approved commit does not duplicate provider mutation or participant notification',async()=>{
  const f=fixture();
  const discovery=await f.service.discover({title:'Sync',participants:['a@example.com'],durationMinutes:30});
  const action=await f.service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  const proposed=await proposeMeetingAction(f.naia,action);
  await f.naia.confirm(proposed.objective.id,proposed.confirmation.id);
  const approved=await f.naia.approve(proposed.objective.id,'meeting.commit');
  assert.equal(approved.objective.status,'COMPLETED');
  const first=await f.service.commit({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:'meeting:'+action.id});
  assert.equal(first.duplicate,true);
  assert.equal((await f.service.notifications(first.meeting.id)).length,1);
});

test('provider failure remains explicit after approval and action does not pretend success',async()=>{
  const f=fixture({failCommit:{code:'PROVIDER_TIMEOUT',message:'timeout',retryable:true}});
  const discovery=await f.service.discover({title:'Sync',participants:['a@example.com'],durationMinutes:30});
  const action=await f.service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  const proposed=await proposeMeetingAction(f.naia,action);
  await f.naia.confirm(proposed.objective.id,proposed.confirmation.id);
  const failed=await f.naia.approve(proposed.objective.id,'meeting.commit');
  assert.equal(failed.objective.status,'FAILED');
  assert.equal((await f.service.getAction(action.id)).status,'FAILED');
});

test('direct meeting commit fails closed before runtime approval',async()=>{
  const f=fixture();
  const discovery=await f.service.discover({title:'Sync',participants:['a@example.com'],durationMinutes:30});
  const action=await f.service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  await assert.rejects(
    f.service.commit({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:'direct'}),
    (error)=>error.code==='APPROVAL_REQUIRED',
  );
});

test('meeting, commit and notification state survive file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-meeting-'));
  try{
    let id=0;
    const provider=createFixtureMeetingProvider({
      name:'calendar',
      slots:[{id:'s1',start:'2026-09-20T10:00:00-03:00',end:'2026-09-20T10:30:00-03:00',timezone:'America/Sao_Paulo',revision:'1',available:true}],
    });
    const firstService=createMeetingService({store:createFileMeetingStore({rootDir:dir}),providers:[provider],idFactory:()=>`id-${++id}`,now:()=> '2026-09-19T14:00:00Z'});
    const firstNaia=createNaiaService(createInMemoryPorts());registerMeetingCapability(firstNaia,{service:firstService});
    const discovery=await firstService.discover({title:'Sync',participants:['a@example.com'],durationMinutes:30,timezone:'America/Sao_Paulo'});
    const action=await firstService.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
    const proposed=await proposeMeetingAction(firstNaia,action);
    await firstNaia.confirm(proposed.objective.id,proposed.confirmation.id);
    await firstNaia.approve(proposed.objective.id,'meeting.commit');
    const secondService=createMeetingService({store:createFileMeetingStore({rootDir:dir}),providers:[provider],now:()=> '2026-09-19T15:00:00Z'});
    const savedAction=await secondService.getAction(action.id);
    assert.equal(savedAction.status,'COMPLETED');
    const duplicate=await secondService.commit({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:`meeting:${action.id}`});
    assert.equal(duplicate.duplicate,true);
    assert.equal((await secondService.notifications(duplicate.meeting.id)).length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

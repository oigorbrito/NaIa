import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionWebUi } from '../../src/product/production-web-ui.mjs';
import { createFrontendApi } from '../../src/product/frontend-api.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createTaskService } from '../../src/product/tasks.mjs';
import { createEntitlementService } from '../../src/product/entitlements.mjs';
import { createUsageMeter } from '../../src/product/metering.mjs';

function fixture(){
  const naia=createNaiaService(createInMemoryPorts());
  const tasks=createTaskService({idFactory:(()=>{let i=0;return()=>`task-${++i}`;})()});
  const entitlements=createEntitlementService();
  const meter=createUsageMeter({entitlements});
  const connectors={async list(){return [{id:'c1',provider:'drive',state:'CONNECTED'}];}};
  const media={async list(){return [{id:'m1',displayName:'photo.jpg',mediaType:'IMAGE',sourceType:'device'}];}};
  const api=createFrontendApi({naia,userId:'u1',tasks,entitlements,meter,connectors,media});
  return {naia,tasks,entitlements,meter,api,ui:createProductionWebUi({api})};
}

test('production shell exposes all core navigation surfaces with navigation accessibility attributes without CLI',async()=>{
  const {ui}=fixture();
  const res=await ui.handle({method:'GET',path:'/'});
  assert.equal(res.status,200);
  assert.match(res.body,/aria-label="Main navigation"/);
  assert.match(res.body,/data-nav="chat"[^>]*aria-current="page"/);
  for(const name of ['chat','objectives','approvals','automations','connectors','history','media','settings']) assert.match(res.body,new RegExp(`data-nav="${name}"`));
});

test('responsive shell includes narrow-screen breakpoint and viewport metadata',async()=>{
  const {ui}=fixture();const res=await ui.handle({method:'GET',path:'/surface/chat'});
  assert.match(res.body,/name="viewport"/);
  assert.match(res.body,/@media \(max-width:720px\)/);
  assert.match(res.body,/grid-template-columns:1fr/);
});

test('approvals surface is actionable only through frontend API/runtime',async()=>{
  const {ui,naia}=fixture();
  const pending=await naia.pursue({title:'note release: ship it'});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  const inbox=await ui.handle({method:'GET',path:'/surface/approvals'});
  assert.match(inbox.body,/note\.write/);
  const approved=await ui.handle({method:'POST',path:'/approve',body:`objectiveId=${encodeURIComponent(pending.objective.id)}&tool=note.write`});
  assert.equal(approved.status,200);
  assert.match(approved.body,/COMPLETED/);
});

test('automations connectors media and premium settings render from shared frontend contract',async()=>{
  const {ui,tasks,entitlements,meter}=fixture();
  await tasks.create({userId:'u1',title:'drink water',schedule:{kind:'ONCE',at:'2026-09-20T09:00:00Z'}});
  await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  await meter.consume({userId:'u1',metric:'executions.daily',window:'DAY',logicalId:'run-1'});
  const automations=await ui.handle({method:'GET',path:'/surface/automations'});assert.match(automations.body,/drink water/);
  const connectors=await ui.handle({method:'GET',path:'/surface/connectors'});assert.match(connectors.body,/drive/);
  const media=await ui.handle({method:'GET',path:'/surface/media'});assert.match(media.body,/photo\.jpg/);
  const settings=await ui.handle({method:'GET',path:'/surface/settings'});assert.match(settings.body,/Plan PRO/);assert.match(settings.body,/executions\.daily/);
});

test('automation cancellation delegates through frontend API and does not mutate store directly',async()=>{
  const {ui,tasks}=fixture();
  const created=await tasks.create({userId:'u1',title:'cancel me',schedule:{kind:'ONCE',at:'2026-09-20T09:00:00Z'}});
  const res=await ui.handle({method:'POST',path:'/automation/cancel',body:`id=${encodeURIComponent(created.task.id)}`});
  assert.equal(res.status,200);
  assert.equal((await tasks.get(created.task.id)).userState,'CANCELLED');
});

test('frontend shell renders explicit offline/degraded retry state',async()=>{
  const api={async shell(){throw Object.assign(new Error('network unavailable'),{code:'OFFLINE',retryable:true});}};
  const ui=createProductionWebUi({api});
  const res=await ui.handle({method:'GET',path:'/surface/history'});
  assert.equal(res.status,503);
  assert.match(res.body,/data-app-state="offline"/);
  assert.match(res.body,/Offline \/ degraded/);
  assert.match(res.body,/Retry/);
});

test('objective failures render retry/resume control and escaped content',async()=>{
  const api={
    async shell(){return {ok:true,surfaces:{history:{objectives:[]},advancedHistory:{available:false},approvals:{},automations:{available:false},connectors:{available:false},media:{available:false},premium:{available:false}}};},
    async objective(){return {ok:true,objective:{id:'o1',title:'<script>x</script>',status:'FAILED',steps:[{kind:'EXECUTE',status:'FAILED',error:'boom'}]}};},
  };
  const ui=createProductionWebUi({api});
  const res=await ui.handle({method:'GET',path:'/objective/o1'});
  assert.equal(res.status,200);
  assert.doesNotMatch(res.body,/<script>/);
  assert.match(res.body,/&lt;script&gt;/);
  assert.match(res.body,/Retry \/ Resume/);
});

test('frontend API exposes media as reusable client contract',async()=>{
  const {api}=fixture();
  const media=await api.mediaState();
  assert.equal(media.ok,true);assert.equal(media.available,true);assert.equal(media.items[0].id,'m1');
  const shell=await api.shell();
  assert.ok(shell.navigation.includes('media'));
  assert.equal(shell.surfaces.media.available,true);
});

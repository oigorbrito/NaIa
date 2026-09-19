import assert from 'node:assert/strict';
import test from 'node:test';
import { createMinimalWebUi } from '../../src/product/minimal-web-ui.mjs';

function objective({id='o1',title='Test',status='COMPLETED',approvals=[],confirmations=[],steps=[]}={}){return {id,title,status,steps,pendingApprovals:approvals,pendingConfirmations:confirmations,evidence:[]};}

function apiFixture(){
  const calls=[];
  const objectives=new Map([['o1',objective({id:'o1',title:'Initial',status:'COMPLETED'})]]);
  return {
    calls,objectives,
    api:{
      async submit({text}){calls.push(['submit',text]);const o=objective({id:'o2',title:text,status:'COMPLETED',steps:[{kind:'EXECUTE',status:'COMPLETED',tool:'time.now'}]});objectives.set('o2',o);return {ok:true,objective:o};},
      async objective(id){calls.push(['objective',id]);const o=objectives.get(id);return o?{ok:true,objective:o}:{ok:false,error:{code:'NOT_FOUND',message:'objective not found'}};},
      async history(){calls.push(['history']);return {ok:true,objectives:[...objectives.values()].map(o=>({id:o.id,title:o.title,status:o.status}))};},
      async approve({objectiveId,tool}){calls.push(['approve',objectiveId,tool]);const o=objectives.get(objectiveId);o.status='COMPLETED';o.pendingApprovals=[];return {ok:true,objective:o};},
      async confirm({objectiveId,confirmationId}){calls.push(['confirm',objectiveId,confirmationId]);const o=objectives.get(objectiveId);o.status='COMPLETED';o.pendingConfirmations=[];return {ok:true,objective:o};},
      async resume(id){calls.push(['resume',id]);const o=objectives.get(id);o.status='COMPLETED';return {ok:true,objective:o};},
    }
  };
}

test('minimal web UI submits supported request through frontend API and renders objective progress',async()=>{
  const fx=apiFixture();const ui=createMinimalWebUi({api:fx.api});
  const res=await ui.handle({method:'POST',path:'/submit',body:'text=what+time+is+it'});
  assert.equal(res.status,200);
  assert.match(res.body,/what time is it/);
  assert.match(res.body,/COMPLETED/);
  assert.match(res.body,/time\.now/);
  assert.deepEqual(fx.calls[0],['submit','what time is it']);
});

test('WAITING_APPROVAL is visible and actionable only through frontend API approve',async()=>{
  const fx=apiFixture();
  fx.objectives.set('a1',objective({id:'a1',title:'Write note',status:'WAITING_APPROVAL',approvals:[{objectiveId:'a1',tool:'note.write',risk:'LOCAL_WRITE'}],steps:[{kind:'EXECUTE',status:'AWAITING_APPROVAL',tool:'note.write'}]}));
  const ui=createMinimalWebUi({api:fx.api});
  const view=await ui.handle({method:'GET',path:'/objective/a1'});
  assert.match(view.body,/Approve note\.write/);
  const approved=await ui.handle({method:'POST',path:'/approve',body:'objectiveId=a1&tool=note.write'});
  assert.equal(approved.status,200);
  assert.deepEqual(fx.calls.at(-1),['approve','a1','note.write']);
});

test('WAITING_CONFIRMATION is visible and actionable through frontend API confirm',async()=>{
  const fx=apiFixture();
  fx.objectives.set('c1',objective({id:'c1',title:'Delete files',status:'WAITING_CONFIRMATION',confirmations:[{objectiveId:'c1',confirmationId:'confirm-1',payload:{count:2}}],steps:[{kind:'EXECUTE',status:'AWAITING_CONFIRMATION'}]}));
  const ui=createMinimalWebUi({api:fx.api});
  const view=await ui.handle({method:'GET',path:'/objective/c1'});
  assert.match(view.body,/Confirm/);
  await ui.handle({method:'POST',path:'/confirm',body:'objectiveId=c1&confirmationId=confirm-1'});
  assert.deepEqual(fx.calls.at(-1),['confirm','c1','confirm-1']);
});

test('history and objective status are inspectable without CLI',async()=>{
  const fx=apiFixture();const ui=createMinimalWebUi({api:fx.api});
  const home=await ui.handle({method:'GET',path:'/'});
  assert.match(home.body,/History/);assert.match(home.body,/Initial/);
  const history=await ui.handle({method:'GET',path:'/history'});
  assert.equal(history.status,200);assert.match(history.body,/\/objective\/o1/);
  const detail=await ui.handle({method:'GET',path:'/objective/o1'});
  assert.equal(detail.status,200);assert.match(detail.body,/Status:/);
});

test('resume action is delegated to frontend API',async()=>{
  const fx=apiFixture();
  fx.objectives.set('r1',objective({id:'r1',title:'Retry',status:'FAILED'}));
  const ui=createMinimalWebUi({api:fx.api});
  const res=await ui.handle({method:'POST',path:'/resume',body:'objectiveId=r1'});
  assert.equal(res.status,200);
  assert.deepEqual(fx.calls.at(-1),['resume','r1']);
});

test('minimal UI escapes objective/request content before rendering HTML',async()=>{
  const fx=apiFixture();const ui=createMinimalWebUi({api:fx.api});
  const res=await ui.handle({method:'POST',path:'/submit',body:{text:'<script>alert(1)</script>'}});
  assert.doesNotMatch(res.body,/<script>/);
  assert.match(res.body,/&lt;script&gt;/);
});

test('unknown routes and missing objectives are explicit non-success states',async()=>{
  const fx=apiFixture();const ui=createMinimalWebUi({api:fx.api});
  assert.equal((await ui.handle({method:'GET',path:'/missing'})).status,404);
  assert.equal((await ui.handle({method:'GET',path:'/objective/missing'})).status,404);
});

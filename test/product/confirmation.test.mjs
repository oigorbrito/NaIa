import assert from 'node:assert/strict';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFrontendApi } from '../../src/product/frontend-api.mjs';

function confirmationPlanner({ risk = 'READ_ONLY', tool = 'text.echo' } = {}) {
  return {
    async plan(objective) {
      return {
        objectiveId: objective.id,
        intent: 'CONFIRMATION_TEST',
        steps: [
          { id: objective.id + ':understand', kind: 'UNDERSTAND', status: 'PENDING', action: null },
          {
            id: objective.id + ':execute', kind: 'EXECUTE', status: 'PENDING',
            confirmation: { required: true, id: 'choice-1', payload: { optionId: 'option-a', label: 'Option A' } },
            action: { tool, input: tool === 'note.write' ? { name: 'confirmed', content: 'yes' } : { text: 'confirmed' }, risk, requiresApproval: risk !== 'READ_ONLY' },
          },
          { id: objective.id + ':verify', kind: 'VERIFY', status: 'PENDING', action: null },
        ],
      };
    },
  };
}

test('confirmation-required step pauses before execution with inspectable evidence', async () => {
  const ports=createInMemoryPorts({planner:confirmationPlanner()});
  const naia=createNaiaService(ports);
  const pending=await naia.pursue({title:'choose option'});
  assert.equal(pending.objective.status,'WAITING_CONFIRMATION');
  assert.equal(pending.plan.steps[1].status,'AWAITING_CONFIRMATION');
  assert.deepEqual(pending.confirmation,{id:'choice-1',payload:{optionId:'option-a',label:'Option A'}});
  const evidence=await ports.evidence.list({objectiveId:pending.objective.id});
  assert.ok(evidence.some((row)=>row.type==='CONFIRMATION_REQUIRED'&&row.confirmationId==='choice-1'));
  assert.equal(evidence.some((row)=>row.type==='STEP_EXECUTED'&&row.stepId===pending.plan.steps[1].id),false);
});

test('wrong or stale confirmation id fails closed', async () => {
  const ports=createInMemoryPorts({planner:confirmationPlanner()});
  const naia=createNaiaService(ports);
  const pending=await naia.pursue({title:'choose option'});
  await assert.rejects(naia.confirm(pending.objective.id,'wrong-choice'),(error)=>error.code==='CONFIRMATION_MISMATCH');
  assert.equal((await naia.get(pending.objective.id)).objective.status,'WAITING_CONFIRMATION');
});

test('valid confirmation resumes read-only step through completion', async () => {
  const ports=createInMemoryPorts({planner:confirmationPlanner()});
  const naia=createNaiaService(ports);
  const pending=await naia.pursue({title:'choose option'});
  const completed=await naia.confirm(pending.objective.id,'choice-1');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.ok(completed.objective.confirmations.includes('choice-1'));
  const evidence=await ports.evidence.list({objectiveId:pending.objective.id});
  assert.ok(evidence.some((row)=>row.type==='CONFIRMATION_RECORDED'&&row.confirmationId==='choice-1'));
});

test('confirmation and risk approval remain distinct sequential gates', async () => {
  const ports=createInMemoryPorts({planner:confirmationPlanner({risk:'LOCAL_WRITE',tool:'note.write'})});
  const naia=createNaiaService(ports);
  const pendingConfirmation=await naia.pursue({title:'choose then write'});
  assert.equal(pendingConfirmation.objective.status,'WAITING_CONFIRMATION');
  const pendingApproval=await naia.confirm(pendingConfirmation.objective.id,'choice-1');
  assert.equal(pendingApproval.objective.status,'WAITING_APPROVAL');
  assert.equal(pendingApproval.plan.steps[1].status,'AWAITING_APPROVAL');
  const completed=await naia.approve(pendingConfirmation.objective.id,'note.write');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.ok(completed.objective.confirmations.includes('choice-1'));
  assert.ok(completed.objective.approvals.includes('note.write'));
});

test('frontend API surfaces and completes pending confirmation separately from approvals', async () => {
  const ports=createInMemoryPorts({planner:confirmationPlanner()});
  const naia=createNaiaService(ports);
  const api=createFrontendApi({naia,userId:'u1'});
  const submitted=await api.submit({text:'choose option'});
  assert.equal(submitted.objective.status,'WAITING_CONFIRMATION');
  assert.equal(submitted.objective.pendingConfirmations.length,1);
  const inbox=await api.approvals();
  assert.equal(inbox.approvals.length,0);
  assert.equal(inbox.confirmations.length,1);
  assert.equal(inbox.confirmations[0].confirmationId,'choice-1');
  const confirmed=await api.confirm({objectiveId:submitted.objective.id,confirmationId:'choice-1'});
  assert.equal(confirmed.ok,true);
  assert.equal(confirmed.objective.status,'COMPLETED');
});

test('resume does not bypass a still-unconfirmed step', async () => {
  const ports=createInMemoryPorts({planner:confirmationPlanner()});
  const naia=createNaiaService(ports);
  const pending=await naia.pursue({title:'choose option'});
  const resumed=await naia.resume(pending.objective.id);
  assert.equal(resumed.objective.status,'WAITING_CONFIRMATION');
  assert.equal(resumed.plan.steps[1].status,'AWAITING_CONFIRMATION');
});

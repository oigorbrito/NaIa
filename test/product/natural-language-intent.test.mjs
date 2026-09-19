import assert from 'node:assert/strict';
import test from 'node:test';
import { interpretText } from '../../src/product/intent.mjs';
import { createIntentPlanner } from '../../src/product/planner.mjs';
import { createHttpTargetRegistry } from '../../src/product/capabilities.mjs';

test('natural language calendar list maps to read-only calendar.list action', async () => {
  const planner = createIntentPlanner();
  const plan = await planner.plan({ id: 'c1', title: 'liste meu calendário' });
  assert.equal(plan.steps[1].action.tool, 'calendar.list');
  assert.equal(plan.steps[1].action.risk, 'READ_ONLY');
  assert.equal(plan.steps[1].action.requiresApproval, false);
});

test('natural language calendar create preserves external-write approval semantics', async () => {
  const planner = createIntentPlanner();
  const plan = await planner.plan({ id: 'c2', title: 'agende evento Demo de 2026-09-20T10:00:00 até 2026-09-20T11:00:00' });
  assert.equal(plan.steps[1].action.tool, 'calendar.create');
  assert.deepEqual(plan.steps[1].action.input, { title: 'Demo', start: '2026-09-20T10:00:00', end: '2026-09-20T11:00:00' });
  assert.equal(plan.steps[1].action.risk, 'EXTERNAL_WRITE');
  assert.equal(plan.steps[1].action.requiresApproval, true);
});

test('natural language calendar update maps event id and changes without losing approval', async () => {
  const planner = createIntentPlanner();
  const plan = await planner.plan({ id: 'c3', title: 'atualize evento event-1 título Updated' });
  assert.equal(plan.steps[1].action.tool, 'calendar.update');
  assert.deepEqual(plan.steps[1].action.input, { eventId: 'event-1', changes: { title: 'Updated' } });
  assert.equal(plan.steps[1].action.risk, 'EXTERNAL_WRITE');
  assert.equal(plan.steps[1].action.requiresApproval, true);
});

test('incomplete calendar create fails closed with missing parameters and no side-effect action', async () => {
  const planner = createIntentPlanner();
  const plan = await planner.plan({ id: 'c4', title: 'crie evento' });
  assert.equal(plan.interpretation.state, 'MISSING_PARAMETER');
  assert.equal(plan.steps[1].status, 'FAILED');
  assert.equal(plan.steps[1].action, null);
});

test('configured HTTP target natural language maps to http.read', async () => {
  const planner = createIntentPlanner();
  const plan = await planner.plan({ id: 'h1', title: 'consulte serviço status-service' });
  assert.equal(plan.steps[1].action.tool, 'http.read');
  assert.deepEqual(plan.steps[1].action.input, { targetId: 'status-service' });
  assert.equal(plan.steps[1].action.risk, 'READ_ONLY');
});

test('unknown configured HTTP target can be marked ambiguous when registry context is available', async () => {
  const targets = createHttpTargetRegistry();
  targets.register({ id: 'status-service', endpoint: 'https://configured.invalid/status' });
  const interpretation = await interpretText('consulte serviço missing-service', { httpTargets: targets });
  assert.equal(interpretation.intent, 'HTTP_READ');
  assert.equal(interpretation.state, 'AMBIGUOUS');
  assert.equal(interpretation.ambiguity, 'configured target is unknown');
});

test('existing deterministic note syntax remains compatible', async () => {
  const planner = createIntentPlanner();
  const plan = await planner.plan({ id: 'n1', title: 'note inbox: remember this' });
  assert.equal(plan.steps[1].action.tool, 'note.write');
  assert.equal(plan.steps[1].action.risk, 'LOCAL_WRITE');
  assert.equal(plan.steps[1].action.requiresApproval, true);
});

test('unsupported request fails closed without side-effect or fallback action', async () => {
  const interpretation = await interpretText('faça uma coisa completamente indefinida');
  assert.equal(interpretation.state, 'UNRECOGNIZED');
  const planner = createIntentPlanner();
  const plan = await planner.plan({ id: 'u1', title: 'faça uma coisa completamente indefinida' });
  assert.equal(plan.steps[1].status, 'FAILED');
  assert.equal(plan.steps[1].action, null);
  assert.equal(plan.steps[1].error, 'UNSUPPORTED_INTENT');
});

test('Portuguese natural-language time query maps to the same read-only time action', async () => {
  const planner=createIntentPlanner();
  for (const title of ['que horas são?', 'qual a hora atual?', 'que hora é']) {
    const plan=await planner.plan({id:`time-${title}`,title});
    assert.equal(plan.steps[1].action.tool,'time.now');
    assert.equal(plan.steps[1].action.risk,'READ_ONLY');
    assert.equal(plan.steps[1].action.requiresApproval,false);
  }
});

test('Portuguese natural-language note maps to the same approval-gated note.write action', async () => {
  const planner=createIntentPlanner();
  const plan=await planner.plan({id:'note-natural',title:'anote uma nota em inbox: comprar filtro de café'});
  assert.equal(plan.steps[1].action.tool,'note.write');
  assert.deepEqual(plan.steps[1].action.input,{name:'inbox',content:'comprar filtro de café'});
  assert.equal(plan.steps[1].action.risk,'LOCAL_WRITE');
  assert.equal(plan.steps[1].action.requiresApproval,true);
});

test('incomplete natural-language note fails closed with missing parameters', async () => {
  const planner=createIntentPlanner();
  const plan=await planner.plan({id:'note-missing',title:'anote uma nota'});
  assert.equal(plan.interpretation.state,'MISSING_PARAMETER');
  assert.equal(plan.steps[1].status,'FAILED');
  assert.equal(plan.steps[1].action,null);
});

test('pre-normalized structured intent preserves the same calendar action/risk semantics', async () => {
  const planner=createIntentPlanner();
  const plan=await planner.plan({
    id:'structured-calendar',
    title:'ignored display title',
    normalizedIntent:{type:'CALENDAR_CREATE',parameters:{title:'Demo',start:'2026-09-20T10:00:00',end:'2026-09-20T11:00:00'}},
  });
  assert.equal(plan.steps[1].action.tool,'calendar.create');
  assert.equal(plan.steps[1].action.risk,'EXTERNAL_WRITE');
  assert.equal(plan.steps[1].action.requiresApproval,true);
  assert.deepEqual(plan.steps[1].action.input,{title:'Demo',start:'2026-09-20T10:00:00',end:'2026-09-20T11:00:00'});
});

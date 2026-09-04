import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createAutomationPlanner, authorWorkflowFromIntent } from '../../src/product/automation-planner.mjs';
import { CapabilityRisk } from '../../src/product/capabilities.mjs';
import { ConnectionStatus } from '../../src/product/connection-state.mjs';

test('natural provider request becomes a declarative authored workflow', async () => {
  const ports = createInMemoryPorts();
  ports.tools.register({ name: 'github.issue.read', provider: 'github', risk: CapabilityRisk.READ_ONLY, scopes: ['github:issues:read'], async invoke() { return { body: 'issue' }; } });
  ports.tools.register({ name: 'gmail.message.send', provider: 'gmail', risk: CapabilityRisk.EXTERNAL_WRITE, scopes: ['gmail:messages:send'], async invoke() { return { sent: true }; } });
  const definition = authorWorkflowFromIntent('read github issue {"repository":"tihotm/NaIa","issue":9} then send email {"to":["a@example.com"],"subject":"Update","body":"done"}', { capabilities: ports.tools });
  assert.equal(definition.steps.length, 2);
  assert.equal(definition.steps[0].capability, 'github.issue.read');
  assert.equal(definition.steps[1].capability, 'gmail.message.send');
  assert.deepEqual(definition.steps[1].dependsOn, ['action-1']);
});

test('automation proposal invokes nothing until explicit confirmation and still preserves write approval', async () => {
  const ports = createInMemoryPorts();
  let reads = 0;
  let sends = 0;
  ports.tools.register({
    name: 'github.issue.read', provider: 'github', risk: CapabilityRisk.READ_ONLY, scopes: ['github:issues:read'],
    async invoke() { reads += 1; return { body: 'Issue body' }; },
  });
  ports.tools.register({
    name: 'gmail.message.send', provider: 'gmail', risk: CapabilityRisk.EXTERNAL_WRITE, scopes: ['gmail:messages:send'],
    async invoke() { sends += 1; return { sent: true }; },
  });
  await ports.connections.save({ provider: 'github', status: ConnectionStatus.CONNECTED, grantedScopes: ['github:issues:read'] });
  await ports.connections.save({ provider: 'gmail', status: ConnectionStatus.CONNECTED, grantedScopes: ['gmail:messages:send'] });
  const fallback = ports.planner;
  ports.planner = createAutomationPlanner({ fallbackPlanner: fallback });
  const naia = createNaiaService(ports);
  const proposed = await naia.propose({ title: 'read github issue {"repository":"tihotm/NaIa","issue":9} then send email {"to":["a@example.com"],"subject":"Update","body":"done"}' });
  assert.equal(proposed.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(proposed.plan.authored, true);
  assert.equal(proposed.plan.declarative, true);
  assert.equal(proposed.proposal.writes.length, 1);
  assert.equal(reads, 0);
  assert.equal(sends, 0);
  await assert.rejects(() => naia.resume(proposed.objective.id), /requires confirmation/);
  const confirmed = await naia.confirm(proposed.objective.id);
  assert.equal(confirmed.objective.status, 'WAITING_APPROVAL');
  assert.equal(reads, 1);
  assert.equal(sends, 0);
  const completed = await naia.approve(proposed.objective.id, 'gmail.message.send');
  assert.equal(completed.objective.status, 'COMPLETED');
  assert.equal(reads, 1);
  assert.equal(sends, 1);
  const snapshot = await naia.get(proposed.objective.id);
  assert.ok(snapshot.evidence.some((event) => event.type === 'AUTOMATION_PROPOSED'));
  assert.ok(snapshot.evidence.some((event) => event.type === 'AUTOMATION_CONFIRMED'));
});

test('confirm rejects objectives that were not proposed', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const completed = await naia.pursue({ title: 'echo hello' });
  await assert.rejects(() => naia.confirm(completed.objective.id), /not awaiting confirmation/);
});

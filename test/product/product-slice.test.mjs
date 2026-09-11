import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { sanitizeForPersistence } from '../../src/product/persistence-safety.mjs';
import { createTriggerRuntime, signTriggerDelivery } from '../../src/product/trigger-runtime.mjs';
import { createScheduleRuntime } from '../../src/product/schedule-runtime.mjs';

test('persistence sanitizer redacts nested sensitive keys without mutating input', () => {
  const input = { Authorization: 'Bearer secret', nested: { password: 'pw' }, rows: [{ api_key: 'key', safe: 1 }] };
  const sanitized = sanitizeForPersistence(input);

  assert.deepEqual(sanitized, {
    Authorization: '[REDACTED]',
    nested: { password: '[REDACTED]' },
    rows: [{ api_key: '[REDACTED]', safe: 1 }],
  });
  assert.deepEqual(input, { Authorization: 'Bearer secret', nested: { password: 'pw' }, rows: [{ api_key: 'key', safe: 1 }] });
  assert.notEqual(sanitized, input);
});

test('in-memory evidence persistence redacts sensitive nested values', async () => {
  const ports = createInMemoryPorts();
  const original = { type: 'TRIGGER_RECEIVED', payload: { access_token: 'secret', value: 'ok' } };
  await ports.evidence.append(original);
  assert.deepEqual(await ports.evidence.list(), [{ type: 'TRIGGER_RECEIVED', payload: { access_token: '[REDACTED]', value: 'ok' } }]);
  assert.equal(original.payload.access_token, 'secret');
});

test('file evidence persistence redacts sensitive values on disk', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-product-safety-'));
  try {
    const ports = createFilePorts({ rootDir });
    await ports.evidence.append({ type: 'RESULT', output: { client_secret: 'secret', result: 'ok' } });
    const stored = await ports.evidence.list();
    assert.deepEqual(stored, [{ type: 'RESULT', output: { client_secret: '[REDACTED]', result: 'ok' } }]);
    assert.doesNotMatch(await readFile(join(rootDir, 'evidence.jsonl'), 'utf8'), /"secret"/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('same idempotency key retries the existing failed objective once', async () => {
  const ports = createInMemoryPorts();
  let calls = 0;
  ports.execution.run = async () => (++calls === 1
    ? { ok: false, error: 'temporary provider failure', retryable: true }
    : { ok: true, output: { recovered: true } });
  const naia = createNaiaService(ports);
  const first = await naia.pursue({ title: 'uppercase: retry me', idempotencyKey: 'delivery-1' });
  const second = await naia.pursue({ title: 'uppercase: retry me', idempotencyKey: 'delivery-1' });

  assert.equal(first.objective.id, second.objective.id);
  assert.equal(second.objective.attempts, 2);
  assert.equal(second.objective.status, 'COMPLETED');
  assert.equal((await ports.objectives.list()).length, 1);
});

test('permanent failure with same idempotency key does not retry', async () => {
  const ports = createInMemoryPorts();
  let calls = 0;
  ports.execution.run = async () => (++calls, { ok: false, error: 'permission denied', retryable: false });
  const naia = createNaiaService(ports);
  const first = await naia.pursue({ title: 'uppercase: do not retry', idempotencyKey: 'delivery-2' });
  const second = await naia.pursue({ title: 'uppercase: do not retry', idempotencyKey: 'delivery-2' });

  assert.equal(calls, 1);
  assert.equal(second.objective.id, first.objective.id);
  assert.equal(second.objective.retryDisposition, 'PERMANENT');
  assert.equal(second.objective.attempts, 1);
});

test('concurrent deliveries with the same idempotency key create one objective', async () => {
  const ports = createInMemoryPorts();
  let calls = 0;
  ports.execution.run = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, output: { calls } };
  };
  const naia = createNaiaService(ports);
  const results = await Promise.all([
    naia.pursue({ title: 'uppercase: concurrent', idempotencyKey: 'delivery-concurrent' }),
    naia.pursue({ title: 'uppercase: concurrent', idempotencyKey: 'delivery-concurrent' }),
  ]);

  assert.equal(results[0].objective.id, results[1].objective.id);
  assert.equal((await ports.objectives.list()).length, 1);
  assert.equal(calls, 3);
});

test('read-only intent is planned, invoked, and evidenced without approval', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const result = await naia.pursue({ title: 'uppercase: hello naia' });

  assert.equal(result.objective.status, 'COMPLETED');
  assert.equal(result.plan.steps[1].action.tool, 'text.uppercase');
  assert.ok(result.plan.steps.every((step) => step.status === 'COMPLETED'));

  const evidence = await ports.evidence.list({ objectiveId: result.objective.id });
  const toolExecution = evidence.find((entry) => entry.type === 'STEP_EXECUTED' && entry.tool === 'text.uppercase');
  assert.equal(toolExecution.output.result.text, 'HELLO NAIA');
  assert.equal(evidence.at(-1).type, 'OBJECTIVE_COMPLETED');
});

test('failed execution stops, persists progress, and resumes from unfinished step', async () => {
  const ports = createInMemoryPorts();
  let calls = 0;
  ports.execution.run = async () => ({ ok: ++calls < 2, output: { calls } });
  const naia = createNaiaService(ports);
  const failed = await naia.pursue({ title: 'uppercase: Resume visibly' });

  assert.equal(failed.objective.status, 'FAILED');
  assert.equal(failed.plan.steps[0].status, 'COMPLETED');
  assert.equal(failed.plan.steps[1].status, 'FAILED');
  assert.equal(failed.plan.steps[2].status, 'PENDING');

  const resumedKinds = [];
  ports.execution.run = async ({ step }) => {
    resumedKinds.push(step.kind);
    return { ok: true, output: { resumed: true } };
  };
  const resumed = await naia.resume(failed.objective.id);

  assert.equal(resumed.objective.status, 'COMPLETED');
  assert.deepEqual(resumedKinds, ['EXECUTE', 'VERIFY']);
  const evidence = await ports.evidence.list({ objectiveId: failed.objective.id });
  assert.equal(evidence.filter((entry) => entry.type === 'OBJECTIVE_RESUMED').length, 1);
  assert.equal(evidence.at(-1).type, 'OBJECTIVE_COMPLETED');
});

test('planner rejects unknown and partially recognized intents before execution', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  await assert.rejects(
    () => naia.pursue({ title: 'list my issues and transfer money' }),
    (error) => error.code === 'UNSUPPORTED_INTENT',
  );
  await assert.rejects(
    () => naia.pursue({ title: 'unrecognized request' }),
    (error) => error.code === 'UNSUPPORTED_INTENT',
  );
  assert.deepEqual(await ports.objectives.list(), []);
  assert.deepEqual(await ports.evidence.list(), []);
});

test('local trigger runtime authenticates, plans, and deduplicates a delivery', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const payload = { text: 'hello from event' };
  const runtime = createTriggerRuntime({
    service: naia,
    secret: 'fixture-secret',
    automation: { id: 'automation-1', enabled: true, eventType: 'fixture.event', intent: (event) => `uppercase: ${event.text}` },
  });
  const body = JSON.stringify(payload);
  const first = await runtime.receive({ rawBody: body, signature: signTriggerDelivery('fixture-secret', payload), deliveryId: 'delivery-1', eventType: 'fixture.event' });
  const replay = await runtime.receive({ rawBody: body, signature: signTriggerDelivery('fixture-secret', payload), deliveryId: 'delivery-1', eventType: 'fixture.event' });

  assert.equal(first.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(replay.objective.id, first.objective.id);
  assert.equal((await ports.objectives.list()).length, 1);
  const confirmed = await naia.confirm(first.objective.id);
  assert.equal(confirmed.objective.status, 'COMPLETED');
  assert.ok((await ports.evidence.list({ objectiveId: first.objective.id })).some((entry) => entry.type === 'CONFIRMED'));
});

test('local trigger runtime rejects invalid authentication without side effects', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const runtime = createTriggerRuntime({ service: naia, secret: 'fixture-secret', automation: { id: 'automation-1', enabled: true, eventType: 'fixture.event', intent: () => 'uppercase: never' } });
  await assert.rejects(() => runtime.receive({ rawBody: '{}', signature: 'sha256=invalid', deliveryId: 'delivery-1', eventType: 'fixture.event' }), (error) => error.code === 'INVALID_TRIGGER_AUTH');
  assert.deepEqual(await ports.objectives.list(), []);
});

test('local E2E persists confirmation, approval, result, and redacted evidence', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-product-e2e-'));
  try {
    const ports = createFilePorts({ rootDir });
    const naia = createNaiaService(ports);
    const payload = { note: 'release-plan', content: 'ship capability', password: 'do-not-persist' };
    const runtime = createTriggerRuntime({
      service: naia,
      secret: 'fixture-secret',
      automation: { id: 'automation-write', enabled: true, eventType: 'fixture.event', intent: (event) => `note ${event.note}: ${event.content}` },
    });
    const rawBody = JSON.stringify(payload);
    const input = { rawBody, signature: signTriggerDelivery('fixture-secret', payload), deliveryId: 'delivery-write-1', eventType: 'fixture.event' };

    const pending = await runtime.receive(input);
    assert.equal(pending.objective.status, 'WAITING_CONFIRMATION');
    assert.equal(await ports.objectives.list().then((items) => items.length), 1);
    assert.equal((await ports.evidence.list({ objectiveId: pending.objective.id })).some((entry) => entry.type === 'STEP_EXECUTED'), false);

    const approval = await naia.confirm(pending.objective.id);
    assert.equal(approval.objective.status, 'WAITING_APPROVAL');
    assert.equal((await ports.evidence.list({ objectiveId: pending.objective.id })).filter((entry) => entry.type === 'STEP_EXECUTED' && entry.tool === 'note.write').length, 0);

    const completed = await naia.approve(pending.objective.id, 'note.write');
    assert.equal(completed.objective.status, 'COMPLETED');
    const note = await readFile(join(rootDir, 'workspace', 'notes', 'release-plan.txt'), 'utf8');
    assert.equal(note, 'ship capability\n');
    const evidenceText = await readFile(join(rootDir, 'evidence.jsonl'), 'utf8');
    assert.doesNotMatch(evidenceText, /do-not-persist/);
    assert.match(evidenceText, /\[REDACTED\]/);
    const evidence = await ports.evidence.list({ objectiveId: pending.objective.id });
    assert.ok(evidence.some((entry) => entry.type === 'OBJECTIVE_COMPLETED'));
    assert.equal(evidence.find((entry) => entry.type === 'TRIGGER_RECEIVED').objectiveId, pending.objective.id);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('concrete local scheduler creates an identifiable occurrence and deduplicates replay', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const secret = 'schedule-secret';
  const trigger = createTriggerRuntime({
    service: naia,
    secret,
    automation: { id: 'automation-schedule', enabled: true, eventType: 'schedule.occurrence', intent: () => 'uppercase: scheduled' },
  });
  const scheduler = createScheduleRuntime({ triggerRuntime: trigger, secret, automationId: 'automation-schedule', schedule: 'manual fixture', timezone: 'America/Sao_Paulo' });
  const first = await scheduler.tick({ occurrenceId: 'occurrence-1', at: '2026-09-09T12:00:00.000Z' });
  const replay = await scheduler.tick({ occurrenceId: 'occurrence-1', at: '2026-09-09T12:00:00.000Z' });

  assert.equal(scheduler.registration.registrationId, 'local-schedule:automation-schedule');
  assert.equal(first.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(replay.objective.id, first.objective.id);
  assert.equal((await ports.objectives.list()).length, 1);
  const completed = await naia.confirm(first.objective.id);
  assert.equal(completed.objective.status, 'COMPLETED');
});

test('restart resumes persisted confirmation state without duplicating the objective', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-product-restart-'));
  try {
    const firstPorts = createFilePorts({ rootDir });
    const firstService = createNaiaService(firstPorts);
    const pending = await firstService.pursue({ title: 'note restart-check: persisted operation', idempotencyKey: 'restart-1', deferConfirmation: true });
    assert.equal(pending.objective.status, 'WAITING_CONFIRMATION');

    const secondPorts = createFilePorts({ rootDir });
    const secondService = createNaiaService(secondPorts);
    const recovered = await secondService.get(pending.objective.id);
    assert.equal(recovered.objective.status, 'WAITING_CONFIRMATION');
    assert.equal(recovered.plan.objectiveId, pending.objective.id);
    const approval = await secondService.confirm(pending.objective.id);
    assert.equal(approval.objective.status, 'WAITING_APPROVAL');
    const completed = await secondService.approve(pending.objective.id, 'note.write');
    assert.equal(completed.objective.status, 'COMPLETED');
    assert.equal((await secondService.history()).length, 1);
    const note = await readFile(join(rootDir, 'workspace', 'notes', 'restart-check.txt'), 'utf8');
    assert.equal(note, 'persisted operation\n');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('trigger negative paths fail closed without side effects', async () => {
  const cases = [
    { code: 'AUTOMATION_DISABLED', enabled: false, eventType: 'fixture.event' },
    { code: 'TRIGGER_MISMATCH', enabled: true, eventType: 'other.event' },
    { code: 'MALFORMED_DELIVERY', enabled: true, rawBody: '{not-json', validSignatureBody: '{not-json', eventType: 'fixture.event' },
  ];
  for (const scenario of cases) {
    const ports = createInMemoryPorts();
    const naia = createNaiaService(ports);
    const automation = { id: `negative-${scenario.code}`, eventType: 'fixture.event', intent: () => 'uppercase: never', enabled: scenario.enabled };
    const runtime = createTriggerRuntime({ service: naia, secret: 'fixture-secret', automation });
    const rawBody = scenario.rawBody ?? '{}';
    const signatureBody = scenario.validSignatureBody ?? JSON.parse(rawBody);
    const suppliedSignature = signTriggerDelivery('fixture-secret', signatureBody);
    await assert.rejects(
      () => runtime.receive({ rawBody, signature: suppliedSignature, deliveryId: 'negative-1', eventType: scenario.eventType }),
      (error) => error.code === scenario.code,
    );
    assert.deepEqual(await ports.objectives.list(), []);
    assert.deepEqual(await ports.evidence.list(), []);
  }
});

test('local write waits for explicit tool approval and then completes', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-product-approval-'));
  try {
    const ports = createFilePorts({ rootDir });
    const naia = createNaiaService(ports);
    const pending = await naia.pursue({ title: 'note release-plan: ship the first useful capability' });

    assert.equal(pending.objective.status, 'WAITING_APPROVAL');
    assert.equal(pending.plan.steps[0].status, 'COMPLETED');
    assert.equal(pending.plan.steps[1].status, 'AWAITING_APPROVAL');
    assert.equal(pending.authorization.tool, 'note.write');

    const before = await naia.get(pending.objective.id);
    assert.ok(before.evidence.some((entry) => entry.type === 'APPROVAL_REQUIRED'));

    const completed = await naia.approve(pending.objective.id, 'note.write');
    assert.equal(completed.objective.status, 'COMPLETED');
    assert.equal(completed.plan.steps[1].status, 'COMPLETED');

    const note = await readFile(join(rootDir, 'workspace', 'notes', 'release-plan.txt'), 'utf8');
    assert.equal(note, 'ship the first useful capability\n');

    const after = await naia.get(pending.objective.id);
    assert.ok(after.evidence.some((entry) => entry.type === 'TOOL_APPROVED'));
    assert.ok(after.evidence.some((entry) => entry.type === 'STEP_EXECUTED' && entry.tool === 'note.write'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('file ports preserve state and history across service instances', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-product-'));
  try {
    const firstPorts = createFilePorts({ rootDir });
    const firstService = createNaiaService(firstPorts);
    const created = await firstService.pursue({ title: 'uppercase persist between processes' });

    const secondPorts = createFilePorts({ rootDir });
    const secondService = createNaiaService(secondPorts);
    const snapshot = await secondService.get(created.objective.id);
    const history = await secondService.history();

    assert.equal(snapshot.objective.status, 'COMPLETED');
    assert.equal(snapshot.plan.steps.length, 3);
    assert.equal(snapshot.evidence[0].type, 'OBJECTIVE_CREATED');
    assert.equal(snapshot.evidence.at(-1).type, 'OBJECTIVE_COMPLETED');
    assert.equal(history[0].id, created.objective.id);
    assert.equal(history[0].status, 'COMPLETED');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('tool catalog exposes risk classification', () => {
  const naia = createNaiaService(createInMemoryPorts());
  const tools = naia.tools();
  assert.deepEqual(tools.find((tool) => tool.name === 'note.write'), { name: 'note.write', risk: 'LOCAL_WRITE' });
  assert.deepEqual(tools.find((tool) => tool.name === 'text.uppercase'), { name: 'text.uppercase', risk: 'READ_ONLY' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';

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
  const failed = await naia.pursue({ title: 'Resume visibly' });

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

test('note.write input validation prevents path traversal, hidden files, and excessive lengths', async () => {
  const ports = createInMemoryPorts();
  const registry = ports.tools;

  await assert.rejects(
    registry.run('note.write', { name: '..', content: 'test' }),
    /note name is required/
  );

  await assert.rejects(
    registry.run('note.write', { name: 'a'.repeat(300), content: 'test' }),
    /note name exceeds maximum length/
  );

  // Path traversal and leading dot attempts are sanitized safely into valid filenames
  const sanitizedPathTraversal = await registry.run('note.write', { name: '../secret', content: 'test' });
  assert.ok(sanitizedPathTraversal.path.endsWith('/workspace/notes/secret.txt'));

  const sanitizedHidden = await registry.run('note.write', { name: '.hidden', content: 'test' });
  assert.ok(sanitizedHidden.path.endsWith('/workspace/notes/hidden.txt'));

  const res = await registry.run('note.write', { name: '  valid-note.txt  ', content: 'hello' });
  assert.ok(res.path.endsWith('valid-note.txt'));
});

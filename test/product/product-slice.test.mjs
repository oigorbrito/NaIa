import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createIntentPlanner } from '../../src/product/planner.mjs';
import { createPlatformRegistry, createPlatformRuntime } from '../../src/product/platform.mjs';
import { createProductShell } from '../../src/product/shell.mjs';
import { createProviderRegistry, createProviderRouter } from '../../src/product/providers.mjs';

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

test('tool registry accepts replaceable capabilities at runtime', async () => {
  const ports = createInMemoryPorts();
  ports.tools.register('text.reverse', {
    risk: 'READ_ONLY',
    capability: 'text.transform',
    description: 'Reverses text',
    async run(input) { return { text: [...String(input?.text ?? '')].reverse().join('') }; },
  });

  assert.deepEqual(ports.tools.describe('text.reverse'), {
    name: 'text.reverse',
    risk: 'READ_ONLY',
    capability: 'text.transform',
    description: 'Reverses text',
  });
  assert.deepEqual(await ports.tools.run('text.reverse', { text: 'NaIA' }), { text: 'AIaN' });
  assert.throws(() => ports.tools.register('text.reverse', { run() {} }), /already registered/);
  assert.equal(ports.tools.unregister('text.reverse'), true);
  assert.equal(ports.tools.has('text.reverse'), false);
});

test('intent planner accepts registered capability rules before the default planner', async () => {
  const planner = createIntentPlanner();
  planner.register({
    match: ({ title }) => title.toLowerCase().startsWith('reverse:'),
    action: ({ title }) => ({
      tool: 'text.reverse',
      input: { text: title.replace(/^reverse:\s*/i, '') },
      risk: 'READ_ONLY',
      requiresApproval: false,
    }),
  });
  const ports = createInMemoryPorts({ planner });
  ports.tools.register('text.reverse', { run: async (input) => ({ text: [...input.text].reverse().join('') }) });
  const result = await createNaiaService(ports).pursue({ title: 'reverse: NaIA' });

  assert.equal(result.objective.status, 'COMPLETED');
  assert.equal(result.plan.steps[1].action.tool, 'text.reverse');
  assert.equal(result.plan.steps[1].action.input.text, 'NaIA');
});

test('intent planner rejects malformed capability actions before execution', async () => {
  const planner = createIntentPlanner({ rules: [{
    match: () => true,
    action: () => ({ tool: 'broken.capability', risk: 'UNKNOWN' }),
  }] });

  await assert.rejects(
    planner.plan({ id: 'objective-1', title: 'anything' }),
    /unsupported planner action risk: UNKNOWN/,
  );
});

test('service registers a capability through its public API', async () => {
  const planner = createIntentPlanner();
  const ports = createInMemoryPorts({ planner });
  const naia = createNaiaService(ports);
  naia.registerCapability({
    name: 'text.reverse',
    tool: {
      risk: 'READ_ONLY',
      capability: 'text.transform',
      async run(input) { return { text: [...input.text].reverse().join('') }; },
    },
    rule: {
      match: ({ title }) => title.startsWith('reverse: '),
      action: ({ title }) => ({
        tool: 'text.reverse', input: { text: title.slice(9) }, risk: 'READ_ONLY', requiresApproval: false,
      }),
    },
  });
  const result = await naia.pursue({ title: 'reverse: NaIA' });

  assert.equal(result.objective.status, 'COMPLETED');
  const evidence = (await naia.get(result.objective.id)).evidence;
  const execution = evidence.find((entry) => entry.type === 'STEP_EXECUTED' && entry.tool === 'text.reverse');
  assert.equal(execution.output.result.text, 'AIaN');
});

test('policy fails closed when planner risk differs from registered tool risk', async () => {
  const planner = createIntentPlanner({ rules: [{
    match: () => true,
    action: () => ({ tool: 'text.echo', input: { text: 'x' }, risk: 'LOCAL_WRITE', requiresApproval: false }),
  }] });
  const ports = createInMemoryPorts({ planner });
  const result = await createNaiaService(ports).pursue({ title: 'unsafe declaration' });

  assert.equal(result.objective.status, 'WAITING_APPROVAL');
  assert.equal(result.authorization.reason, 'risk-mismatch');
  assert.equal(result.authorization.risk, 'READ_ONLY');
});

test('platform registry resolves capabilities without coupling the product core to a platform', async () => {
  const platforms = createPlatformRegistry();
  platforms.register('web', {
    capabilities: () => ['notifications.show'],
    async invoke(capability, input) { return { capability, delivered: input.message }; },
  });

  assert.deepEqual(platforms.list(), ['web']);
  assert.deepEqual(platforms.capabilities('web'), ['notifications.show']);
  assert.deepEqual(await platforms.invoke('web', 'notifications.show', { message: 'hello' }), {
    capability: 'notifications.show', delivered: 'hello',
  });
  await assert.rejects(platforms.invoke('web', 'calendar.open'), /not supported on web/);
  assert.throws(() => platforms.register('xbox', {}), /unsupported platform/);
});

test('product shell dispatches commands through the service boundary', async () => {
  const calls = [];
  const shell = createProductShell({
    async pursue(input) { calls.push(['pursue', input]); return { ok: true }; },
    async history() { calls.push(['history']); return []; },
  });

  assert.deepEqual(await shell.execute('pursue', ['hello', 'naia']), { ok: true });
  assert.deepEqual(await shell.execute('history'), []);
  assert.deepEqual(calls, [['pursue', { title: 'hello naia' }], ['history']]);
  await assert.rejects(shell.execute('pursue'), /Usage: pursue/);
  await assert.rejects(shell.execute('unknown'), /Unknown command/);
});

test('platform runtime exposes only the selected client adapter', async () => {
  const registry = createPlatformRegistry();
  registry.register('android', {
    capabilities: () => ['notifications.show'],
    async invoke(capability) { return { capability, platform: 'android' }; },
  });
  const runtime = createPlatformRuntime({ platform: 'ANDROID', registry });

  assert.equal(runtime.platform, 'android');
  assert.deepEqual(runtime.capabilities(), ['notifications.show']);
  assert.deepEqual(await runtime.invoke('notifications.show'), {
    capability: 'notifications.show', platform: 'android',
  });
});

test('reminder intent creates a persisted task after approval', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-task-'));
  try {
    const ports = createFilePorts({ rootDir });
    const naia = createNaiaService(ports);
    const pending = await naia.pursue({ title: 'remind me on Friday: call the dentist' });
    assert.equal(pending.objective.status, 'WAITING_APPROVAL');
    assert.equal(pending.authorization.tool, 'task.create');
    const completed = await naia.approve(pending.objective.id, 'task.create');
    assert.equal(completed.objective.status, 'COMPLETED');
    const tasks = (await readFile(join(rootDir, 'workspace', 'tasks.jsonl'), 'utf8'))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(tasks.length, 1);
    assert.deepEqual({ title: tasks[0].title, due: tasks[0].due }, { title: 'call the dentist', due: 'Friday' });
    assert.equal((await ports.tools.run('task.list')).tasks.length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('provider registry exposes a neutral completion contract', async () => {
  const providers = createProviderRegistry();
  providers.register('OpenAI-compatible', {
    capabilities: () => ['chat.completions'],
    async complete(request) { return { text: `echo:${request.input}`, usage: { totalTokens: 1 } }; },
  });

  assert.deepEqual(providers.list(), ['openai-compatible']);
  assert.deepEqual(providers.capabilities('openai-compatible'), ['chat.completions']);
  assert.deepEqual(await providers.complete('openai-compatible', { input: 'hello' }), {
    text: 'echo:hello', usage: { totalTokens: 1 },
  });
  await assert.rejects(providers.complete('missing', {}), /provider not registered/);
});

test('provider router selects compatible providers and falls back after failure', async () => {
  const providers = createProviderRegistry();
  providers.register('primary', {
    capabilities: () => ['chat.completions'],
    async complete() { throw new Error('temporarily unavailable'); },
  });
  providers.register('fallback', {
    capabilities: () => ['chat.completions'],
    async complete() { return { text: 'fallback response' }; },
  });
  const router = createProviderRouter({ registry: providers, order: ['primary', 'fallback'] });

  assert.deepEqual(await router.complete({ input: 'hello' }), {
    provider: 'fallback', response: { text: 'fallback response' },
  });
});

test('workspace inventory stays read-only and scoped to its root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-files-'));
  try {
    const ports = createFilePorts({ rootDir });
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'time' });
    const inventory = await ports.tools.run('workspace.list');
    assert.deepEqual(inventory, { files: ['evidence.jsonl', 'objectives.json', 'plans.json'] });
    assert.equal(result.objective.status, 'COMPLETED');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('workspace classification groups known file formats without reading contents', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-classify-'));
  try {
    const ports = createFilePorts({ rootDir });
    const { writeFile: write } = await import('node:fs/promises');
    await write(join(rootDir, 'photo.jpg'), 'not inspected');
    await write(join(rootDir, 'invoice.pdf'), 'not inspected');
    await write(join(rootDir, 'unknown.bin'), 'not inspected');
    const result = await ports.tools.run('workspace.classify');
    assert.deepEqual(result.files, [
      { path: 'invoice.pdf', category: 'DOCUMENT' },
      { path: 'photo.jpg', category: 'MEDIA' },
      { path: 'unknown.bin', category: 'OTHER' },
    ]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('workspace duplicate detection is hash-based and non-destructive', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-duplicates-'));
  try {
    const ports = createFilePorts({ rootDir });
    const { writeFile: write } = await import('node:fs/promises');
    await write(join(rootDir, 'a.txt'), 'same');
    await write(join(rootDir, 'b.txt'), 'same');
    await write(join(rootDir, 'c.txt'), 'different');
    const result = await ports.tools.run('workspace.duplicates');
    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0].paths, ['a.txt', 'b.txt']);
    assert.equal(await readFile(join(rootDir, 'a.txt'), 'utf8'), 'same');
    assert.equal(await readFile(join(rootDir, 'b.txt'), 'utf8'), 'same');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function safeNoteName(name) {
  const value = String(name ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!value) throw new Error('note name is required');
  return value.endsWith('.txt') ? value : `${value}.txt`;
}

function assertTool(definition) {
  if (!definition || typeof definition !== 'object') throw new Error('tool definition must be an object');
  const name = String(definition.name ?? '').trim();
  if (!name) throw new Error('tool name is required');
  if (!String(definition.risk ?? '').trim()) throw new Error(`tool ${name} risk is required`);
  if (typeof definition.run !== 'function') throw new Error(`tool ${name} run must be a function`);
  return { ...definition, name };
}

export function createToolRegistry({ rootDir = '.naia', tools: initialTools = [] } = {}) {
  const tools = new Map();

  function register(definition) {
    const tool = assertTool(definition);
    if (tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`);
    tools.set(tool.name, tool);
    return tool.name;
  }

  register({
    name: 'time.now',
    risk: 'READ_ONLY',
    async run() {
      return { iso: new Date().toISOString() };
    },
  });
  register({
    name: 'text.uppercase',
    risk: 'READ_ONLY',
    async run(input) {
      return { text: String(input?.text ?? '').toUpperCase() };
    },
  });
  register({
    name: 'text.echo',
    risk: 'READ_ONLY',
    async run(input) {
      return { text: String(input?.text ?? '') };
    },
  });
  register({
    name: 'note.write',
    risk: 'LOCAL_WRITE',
    async run(input) {
      const notesDir = join(rootDir, 'workspace', 'notes');
      await mkdir(notesDir, { recursive: true });
      const filename = safeNoteName(input?.name);
      const path = join(notesDir, filename);
      await writeFile(path, `${String(input?.content ?? '')}\n`, 'utf8');
      return { path, bytes: Buffer.byteLength(`${String(input?.content ?? '')}\n`, 'utf8') };
    },
  });

  for (const tool of initialTools) register(tool);

  return {
    register,
    has(name) { return tools.has(name); },
    describe(name) {
      const tool = tools.get(name);
      return tool ? { name, risk: tool.risk } : null;
    },
    list() { return [...tools.entries()].map(([name, tool]) => ({ name, risk: tool.risk })); },
    async run(name, input) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`tool not found: ${name}`);
      return tool.run(input ?? {});
    },
  };
}

export function createLocalExecutionAdapter({ registry }) {
  return {
    async run({ step }) {
      if (!step.action) return { ok: true, output: { controlStep: step.kind } };
      try {
        const output = await registry.run(step.action.tool, step.action.input);
        return { ok: true, output: { tool: step.action.tool, result: output } };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error), retryable: error?.retryable !== false };
      }
    },
  };
}

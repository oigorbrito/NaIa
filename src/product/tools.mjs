import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

function safeNoteName(name) {
  const raw = String(name ?? '').trim();
  if (raw.includes('/') || raw.includes('\\')) {
    throw new Error('invalid note name: path separators are not allowed');
  }
  const value = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!value || value === '.' || value === '..') throw new Error('note name is required');
  return value.endsWith('.txt') ? value : `${value}.txt`;
}

export function createToolRegistry({ rootDir = '.naia' } = {}) {
  const tools = new Map([
    ['time.now', {
      risk: 'READ_ONLY',
      async run() {
        return { iso: new Date().toISOString() };
      },
    }],
    ['text.uppercase', {
      risk: 'READ_ONLY',
      async run(input) {
        return { text: String(input?.text ?? '').toUpperCase() };
      },
    }],
    ['text.echo', {
      risk: 'READ_ONLY',
      async run(input) {
        return { text: String(input?.text ?? '') };
      },
    }],
    ['note.write', {
      risk: 'LOCAL_WRITE',
      async run(input) {
        const notesDir = resolve(rootDir, 'workspace', 'notes');
        await mkdir(notesDir, { recursive: true });
        const filename = safeNoteName(input?.name);
        const path = resolve(notesDir, filename);
        const rel = relative(notesDir, path);
        if (rel.startsWith('..') || resolve(path) !== path || rel === '..') {
          throw new Error('invalid note path: path traversal detected');
        }
        await writeFile(path, `${String(input?.content ?? '')}\n`, 'utf8');
        return { path, bytes: Buffer.byteLength(`${String(input?.content ?? '')}\n`, 'utf8') };
      },
    }],
  ]);

  return {
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
        return { ok: false, output: { tool: step.action.tool, error: error?.message ?? String(error) } };
      }
    },
  };
}

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CapabilityRisk, createCapabilityRegistry } from './capabilities.mjs';

function safeNoteName(name) {
  const value = String(name ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!value) throw new Error('note name is required');
  return value.endsWith('.txt') ? value : `${value}.txt`;
}

export function createToolRegistry({ rootDir = '.naia', capabilities = [] } = {}) {
  const registry = createCapabilityRegistry([
    { name: 'time.now', risk: CapabilityRisk.READ_ONLY, scopes: ['clock:read'], description: 'Read the current local process time as ISO-8601.', source: 'local', async invoke() { return { iso: new Date().toISOString() }; } },
    { name: 'text.uppercase', risk: CapabilityRisk.READ_ONLY, scopes: ['text:transform'], description: 'Transform text to uppercase.', source: 'local', async invoke(input) { return { text: String(input?.text ?? '').toUpperCase() }; } },
    { name: 'text.echo', risk: CapabilityRisk.READ_ONLY, scopes: ['text:read'], description: 'Echo text unchanged.', source: 'local', async invoke(input) { return { text: String(input?.text ?? '') }; } },
    {
      name: 'note.write', risk: CapabilityRisk.LOCAL_WRITE, scopes: ['workspace:notes:write'], description: 'Write a note into the local NaIA workspace.', source: 'local',
      async invoke(input) {
        const notesDir = join(rootDir, 'workspace', 'notes');
        await mkdir(notesDir, { recursive: true });
        const filename = safeNoteName(input?.name);
        const path = join(notesDir, filename);
        const body = `${String(input?.content ?? '')}\n`;
        await writeFile(path, body, 'utf8');
        return { path, bytes: Buffer.byteLength(body, 'utf8') };
      },
    },
    ...capabilities,
  ]);

  return {
    register: registry.register,
    has: registry.has,
    describe: registry.describe,
    list() { return registry.list().map(({ name, risk }) => ({ name, risk })); },
    catalog() { return registry.list(); },
    async run(name, input, context = {}) { return registry.invoke(name, input, context); },
  };
}

export function createLocalExecutionAdapter({ registry }) {
  return {
    async run({ objective, plan, step }) {
      if (!step.action) return { ok: true, output: { controlStep: step.kind } };
      const capability = step.action.capability ?? step.action.tool;
      try {
        const output = await registry.run(capability, step.action.input, { objective, plan, step });
        return { ok: true, output: { capability, tool: capability, result: output } };
      } catch (error) {
        return { ok: false, output: { capability, tool: capability, error: error?.message ?? String(error) } };
      }
    },
  };
}

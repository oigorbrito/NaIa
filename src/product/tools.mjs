import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

function safeNoteName(name) {
  const raw = String(name ?? '').trim();
  if (raw.includes('/') || raw.includes('\\')) throw new Error('invalid note name: path separators are not allowed');
  const value = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[\s._-]+|[\s._-]+$/g, '');
  if (!value || value === '.' || value === '..') throw new Error('note name is required');
  const filename = value.endsWith('.txt') ? value : `${value}.txt`;
  if (filename.length > 255) throw new Error('note name exceeds maximum length');
  return filename;
}

function fileCategory(name) {
  const extension = String(name).split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'mp4', 'mov'].includes(extension)) return 'MEDIA';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'odt'].includes(extension)) return 'DOCUMENT';
  if (['json', 'csv', 'tsv', 'xlsx', 'xls'].includes(extension)) return 'DATA';
  return 'OTHER';
}

export function createToolRegistry({ rootDir = '.naia' } = {}) {
  async function listWorkspaceFiles(directory, prefix = '') {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    const files = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...await listWorkspaceFiles(join(directory, entry.name), relative));
      else if (entry.isFile()) files.push(relative);
    }
    return files.sort();
  }
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
        const filename = safeNoteName(input?.name);
        const path = resolve(notesDir, filename);
        const rel = relative(notesDir, path);
        if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('invalid note path: path traversal detected');
        await mkdir(notesDir, { recursive: true });
        await writeFile(path, `${String(input?.content ?? '')}\n`, 'utf8');
        return { path, bytes: Buffer.byteLength(`${String(input?.content ?? '')}\n`, 'utf8') };
      },
    }],
    ['workspace.list', {
      risk: 'READ_ONLY',
      capability: 'files.inventory',
      description: 'Lists files in the local NaIA workspace',
      async run() { return { files: await listWorkspaceFiles(rootDir) }; },
    }],
    ['workspace.classify', {
      risk: 'READ_ONLY',
      capability: 'files.classification',
      description: 'Classifies workspace files by extension',
      async run() {
        const files = await listWorkspaceFiles(rootDir);
        return { files: files.map((path) => ({ path, category: fileCategory(path) })) };
      },
    }],
    ['workspace.duplicates', {
      risk: 'READ_ONLY',
      capability: 'files.duplicates',
      description: 'Finds duplicate workspace files by content hash',
      async run() {
        const files = await listWorkspaceFiles(rootDir);
        const groups = new Map();
        for (const path of files) {
          const digest = createHash('sha256').update(await readFile(join(rootDir, path))).digest('hex');
          const group = groups.get(digest) ?? [];
          group.push(path);
          groups.set(digest, group);
        }
        return { groups: [...groups.entries()]
          .filter(([, paths]) => paths.length > 1)
          .map(([hash, paths]) => ({ hash, paths })) };
      },
    }],
    ['task.create', {
      risk: 'LOCAL_WRITE',
      capability: 'tasks.reminders',
      description: 'Creates a local task or reminder',
      async run(input) {
        const tasksPath = join(rootDir, 'workspace', 'tasks.jsonl');
        await mkdir(join(rootDir, 'workspace'), { recursive: true });
        const task = {
          id: randomUUID(),
          title: String(input?.title ?? '').trim(),
          due: input?.due ?? null,
          createdAt: new Date().toISOString(),
        };
        if (!task.title) throw new Error('task title is required');
        await appendFile(tasksPath, `${JSON.stringify(task)}\n`, 'utf8');
        return task;
      },
    }],
    ['task.list', {
      risk: 'READ_ONLY',
      capability: 'tasks.reminders',
      description: 'Lists local tasks and reminders',
      async run() {
        const tasksPath = join(rootDir, 'workspace', 'tasks.jsonl');
        try {
          const content = await readFile(tasksPath, 'utf8');
          return { tasks: content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) };
        } catch (error) {
          if (error?.code === 'ENOENT') return { tasks: [] };
          throw error;
        }
      },
    }],
  ]);

  function normalizeDefinition(name, definition) {
    if (!name || !String(name).trim()) throw new Error('tool name is required');
    if (!definition || typeof definition.run !== 'function') {
      throw new Error(`tool ${name} must provide a run function`);
    }
    const risk = definition.risk ?? 'READ_ONLY';
    if (!['READ_ONLY', 'LOCAL_WRITE', 'EXTERNAL_WRITE', 'SENSITIVE'].includes(risk)) {
      throw new Error(`unsupported tool risk: ${risk}`);
    }
    return {
      risk,
      description: definition.description ?? null,
      capability: definition.capability ?? null,
      run: definition.run,
    };
  }

  return {
    has(name) { return tools.has(name); },
    register(name, definition, { replace = false } = {}) {
      const key = String(name ?? '').trim();
      if (!replace && tools.has(key)) throw new Error(`tool already registered: ${key}`);
      tools.set(key, normalizeDefinition(key, definition));
      return this.describe(key);
    },
    unregister(name) {
      return tools.delete(name);
    },
    describe(name) {
      const tool = tools.get(name);
      return tool ? {
        name,
        risk: tool.risk,
        ...(tool.description ? { description: tool.description } : {}),
        ...(tool.capability ? { capability: tool.capability } : {}),
      } : null;
    },
    list() { return [...tools.keys()].map((name) => this.describe(name)); },
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

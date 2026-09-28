import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(value) { return value == null ? value : structuredClone(value); }

export function createControlPlaneJournal(initial = []) {
  const rows = initial.map(clone);
  return {
    async append(entry) { rows.push(clone(entry)); return clone(entry); },
    async list({ limit = 50 } = {}) { return rows.slice(-Math.max(1, limit)).reverse().map(clone); },
  };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}
async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFileControlPlaneJournal({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'control-plane-maintenance.json');
  return {
    async append(entry) {
      const rows = await readJson(path, []);
      rows.push(clone(entry));
      await writeJsonAtomic(path, rows);
      return clone(entry);
    },
    async list({ limit = 50 } = {}) {
      const rows = await readJson(path, []);
      return rows.slice(-Math.max(1, limit)).reverse().map(clone);
    },
  };
}

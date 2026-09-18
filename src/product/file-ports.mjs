import { mkdir, readFile, rename, writeFile, appendFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { planIntent } from './planner.mjs';
import { createApprovalPolicy } from './policy.mjs';
import { createLocalExecutionAdapter, createToolRegistry } from './tools.mjs';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFilePorts({ rootDir = '.naia' } = {}) {
  const objectivesPath = join(rootDir, 'objectives.json');
  const plansPath = join(rootDir, 'plans.json');
  const evidencePath = join(rootDir, 'evidence.jsonl');
  const registry = createToolRegistry({ rootDir });

  // Cache JSON maps by file path and modification time (mtimeMs) to eliminate redundant disk reads/parses
  const mapCache = new Map();

  async function readMap(path) {
    try {
      const st = await stat(path);
      const cached = mapCache.get(path);
      if (cached && cached.mtimeMs === st.mtimeMs) {
        return structuredClone(cached.data);
      }
      const data = await readJson(path, {});
      mapCache.set(path, { mtimeMs: st.mtimeMs, data });
      return structuredClone(data);
    } catch (error) {
      if (error?.code === 'ENOENT') return {};
      throw error;
    }
  }

  async function saveMap(path, value) {
    await writeJsonAtomic(path, value);
    try {
      const st = await stat(path);
      mapCache.set(path, { mtimeMs: st.mtimeMs, data: structuredClone(value) });
    } catch {
      mapCache.delete(path);
    }
  }

  const evidenceCache = { mtimeMs: 0, rows: [] };

  async function readEvidence() {
    try {
      const st = await stat(evidencePath);
      if (evidenceCache.mtimeMs > 0 && st.mtimeMs === evidenceCache.mtimeMs) {
        return structuredClone(evidenceCache.rows);
      }
      const text = await readFile(evidencePath, 'utf8');
      const rows = text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      evidenceCache.mtimeMs = st.mtimeMs;
      evidenceCache.rows = rows;
      return structuredClone(rows);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  return {
    objectives: {
      async save(objective) {
        const all = await readMap(objectivesPath);
        all[objective.id] = structuredClone(objective);
        await saveMap(objectivesPath, all);
        return objective;
      },
      async get(id) {
        const all = await readMap(objectivesPath);
        return all[id] ? structuredClone(all[id]) : null;
      },
      async list() {
        return Object.values(await readMap(objectivesPath)).map((value) => structuredClone(value));
      },
    },
    plans: {
      async save(plan) {
        const all = await readMap(plansPath);
        all[plan.objectiveId] = structuredClone(plan);
        await saveMap(plansPath, all);
        return plan;
      },
      async get(objectiveId) {
        const all = await readMap(plansPath);
        return all[objectiveId] ? structuredClone(all[objectiveId]) : null;
      },
    },
    evidence: {
      async append(record) {
        await mkdir(dirname(evidencePath), { recursive: true });
        await appendFile(evidencePath, `${JSON.stringify(record)}\n`, 'utf8');
        try {
          const st = await stat(evidencePath);
          if (evidenceCache.mtimeMs > 0) {
            evidenceCache.mtimeMs = st.mtimeMs;
            evidenceCache.rows.push(structuredClone(record));
          }
        } catch {
          evidenceCache.mtimeMs = 0;
          evidenceCache.rows = [];
        }
        return record;
      },
      async list({ objectiveId } = {}) {
        const rows = await readEvidence();
        return objectiveId ? rows.filter((row) => row.objectiveId === objectiveId) : rows;
      },
    },
    planner: { async plan(objective) { return planIntent(objective); } },
    policy: createApprovalPolicy(),
    execution: createLocalExecutionAdapter({ registry }),
    tools: registry,
  };
}

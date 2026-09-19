import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
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

  // Bolt optimization: Cache JSON maps in memory per file ports instance to eliminate redundant disk reads
  // and JSON parsing during consecutive reads/writes (e.g., during multi-step plan execution).
  let objectivesMap = null;
  let objectivesReadPromise = null;

  let plansMap = null;
  let plansReadPromise = null;

  async function getObjectivesMap() {
    if (objectivesMap) return objectivesMap;
    if (!objectivesReadPromise) {
      objectivesReadPromise = readJson(objectivesPath, {})
        .then((data) => {
          objectivesMap = data;
          return objectivesMap;
        })
        .catch((err) => {
          objectivesReadPromise = null;
          throw err;
        });
    }
    return objectivesReadPromise;
  }

  async function getPlansMap() {
    if (plansMap) return plansMap;
    if (!plansReadPromise) {
      plansReadPromise = readJson(plansPath, {})
        .then((data) => {
          plansMap = data;
          return plansMap;
        })
        .catch((err) => {
          plansReadPromise = null;
          throw err;
        });
    }
    return plansReadPromise;
  }

  return {
    objectives: {
      async save(objective) {
        const all = await getObjectivesMap();
        all[objective.id] = structuredClone(objective);
        try {
          await writeJsonAtomic(objectivesPath, all);
        } catch (error) {
          objectivesMap = null;
          objectivesReadPromise = null;
          throw error;
        }
        return objective;
      },
      async get(id) {
        const all = await getObjectivesMap();
        return all[id] ? structuredClone(all[id]) : null;
      },
      async list() {
        const all = await getObjectivesMap();
        return Object.values(all).map((value) => structuredClone(value));
      },
    },
    plans: {
      async save(plan) {
        const all = await getPlansMap();
        all[plan.objectiveId] = structuredClone(plan);
        try {
          await writeJsonAtomic(plansPath, all);
        } catch (error) {
          plansMap = null;
          plansReadPromise = null;
          throw error;
        }
        return plan;
      },
      async get(objectiveId) {
        const all = await getPlansMap();
        return all[objectiveId] ? structuredClone(all[objectiveId]) : null;
      },
    },
    evidence: {
      async append(record) {
        await mkdir(dirname(evidencePath), { recursive: true });
        await appendFile(evidencePath, `${JSON.stringify(record)}\n`, 'utf8');
        return record;
      },
      async list({ objectiveId } = {}) {
        try {
          const rows = (await readFile(evidencePath, 'utf8'))
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
          return objectiveId ? rows.filter((row) => row.objectiveId === objectiveId) : rows;
        } catch (error) {
          if (error?.code === 'ENOENT') return [];
          throw error;
        }
      },
    },
    planner: { async plan(objective) { return planIntent(objective); } },
    policy: createApprovalPolicy(),
    execution: createLocalExecutionAdapter({ registry }),
    tools: registry,
  };
}

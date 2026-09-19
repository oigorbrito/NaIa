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

  // In-memory caching to avoid redundant file reads & JSON parses on every port operation
  let objectivesMap = null;
  let objectivesReadPromise = null;
  let objectivesWriteChain = Promise.resolve();

  let plansMap = null;
  let plansReadPromise = null;
  let plansWriteChain = Promise.resolve();

  async function getObjectivesMap() {
    if (objectivesMap) return objectivesMap;
    if (!objectivesReadPromise) {
      objectivesReadPromise = readJson(objectivesPath, {}).then(
        (data) => {
          objectivesMap = data;
          objectivesReadPromise = null;
          return data;
        },
        (err) => {
          objectivesReadPromise = null;
          throw err;
        }
      );
    }
    return objectivesReadPromise;
  }

  async function getPlansMap() {
    if (plansMap) return plansMap;
    if (!plansReadPromise) {
      plansReadPromise = readJson(plansPath, {}).then(
        (data) => {
          plansMap = data;
          plansReadPromise = null;
          return data;
        },
        (err) => {
          plansReadPromise = null;
          throw err;
        }
      );
    }
    return plansReadPromise;
  }

  return {
    objectives: {
      save(objective) {
        const task = async () => {
          try {
            const all = await getObjectivesMap();
            const updated = { ...all, [objective.id]: structuredClone(objective) };
            await writeJsonAtomic(objectivesPath, updated);
            objectivesMap = updated;
            return objective;
          } catch (err) {
            objectivesMap = null;
            throw err;
          }
        };
        objectivesWriteChain = objectivesWriteChain.catch(() => {}).then(task);
        return objectivesWriteChain;
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
      save(plan) {
        const task = async () => {
          try {
            const all = await getPlansMap();
            const updated = { ...all, [plan.objectiveId]: structuredClone(plan) };
            await writeJsonAtomic(plansPath, updated);
            plansMap = updated;
            return plan;
          } catch (err) {
            plansMap = null;
            throw err;
          }
        };
        plansWriteChain = plansWriteChain.catch(() => {}).then(task);
        return plansWriteChain;
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
    policy: createApprovalPolicy({ registry }),
    execution: createLocalExecutionAdapter({ registry }),
    tools: registry,
  };
}

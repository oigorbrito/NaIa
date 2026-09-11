import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createDefaultCapabilityRegistry } from './capabilities.mjs';
import { createExecutionRouter } from './execution-router.mjs';
import { createCapabilityPlanner } from './planner.mjs';
import { createApprovalPolicy } from './policy.mjs';
import { createToolRegistry } from './tools.mjs';
import { sanitizeForPersistence } from './persistence-safety.mjs';

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

export function createFilePorts({
  rootDir = '.naia',
  capabilities = createDefaultCapabilityRegistry(),
  tools = [],
  executionAdapters = [],
} = {}) {
  const objectivesPath = join(rootDir, 'objectives.json');
  const plansPath = join(rootDir, 'plans.json');
  const evidencePath = join(rootDir, 'evidence.jsonl');
  const registry = createToolRegistry({ rootDir, tools });
  const planner = createCapabilityPlanner({ capabilities });

  async function readMap(path) {
    return readJson(path, {});
  }

  return {
    objectives: {
      async save(objective) {
        const all = await readMap(objectivesPath);
        all[objective.id] = sanitizeForPersistence(objective);
        await writeJsonAtomic(objectivesPath, all);
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
        all[plan.objectiveId] = sanitizeForPersistence(plan);
        await writeJsonAtomic(plansPath, all);
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
        await appendFile(evidencePath, `${JSON.stringify(sanitizeForPersistence(record))}\n`, 'utf8');
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
    planner,
    policy: createApprovalPolicy(),
    execution: createExecutionRouter({ registry, adapters: executionAdapters }),
    tools: registry,
    capabilities,
  };
}

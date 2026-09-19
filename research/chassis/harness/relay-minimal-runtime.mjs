import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const terminalStates = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function clone(value) {
  return structuredClone(value);
}

function assertRuntimePorts(ports) {
  for (const name of ['runs', 'planner', 'policy', 'execution']) {
    if (!ports?.[name]) throw new Error('missing relay spike port: ' + name);
  }
  for (const method of ['save', 'get']) {
    if (typeof ports.runs[method] !== 'function') throw new Error('runs.' + method + ' must be a function');
  }
  if (typeof ports.planner.plan !== 'function') throw new Error('planner.plan must be a function');
  if (typeof ports.policy.authorize !== 'function') throw new Error('policy.authorize must be a function');
  if (typeof ports.execution.run !== 'function') throw new Error('execution.run must be a function');
  return ports;
}

function normalizedUsage(usage) {
  return {
    tokens: Number.isFinite(usage?.tokens) ? usage.tokens : 0,
    cost: Number.isFinite(usage?.cost) ? usage.cost : 0,
  };
}

function addUsage(total, usage) {
  const next = normalizedUsage(usage);
  total.tokens += next.tokens;
  total.cost += next.cost;
}

function validateRequiredOutputs(required, files) {
  if (!Array.isArray(required) || required.length === 0) return { ok: true, missing: [] };
  const produced = new Set(Object.keys(files ?? {}).filter((key) => {
    const value = files[key];
    return value !== null && value !== undefined && String(value).length > 0;
  }));
  const missing = required.filter((filePath) => !produced.has(filePath));
  return { ok: missing.length === 0, missing };
}

export function createMemoryRelayStore() {
  const rows = new Map();
  return {
    async save(run) {
      rows.set(run.objectiveId, clone(run));
      return clone(run);
    },
    async get(objectiveId) {
      const row = rows.get(objectiveId);
      return row ? clone(row) : null;
    },
  };
}

async function readRelayJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return { runs: {} }; throw error; }
}
async function writeRelayJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFileRelayStore({ rootDir = '.naia-relay-spike' } = {}) {
  const path = join(rootDir, 'runs.json');
  let chain = Promise.resolve();
  async function mutate(fn) {
    chain = chain.catch(() => {}).then(async () => {
      const data = await readRelayJson(path);
      const result = await fn(data);
      await writeRelayJsonAtomic(path, data);
      return clone(result);
    });
    return chain;
  }
  return {
    path,
    async save(run) { return mutate((data) => { data.runs[run.objectiveId] = clone(run); return run; }); },
    async get(objectiveId) { const data = await readRelayJson(path); const row = data.runs?.[String(objectiveId)]; return row ? clone(row) : null; },
  };
}

export function createRelayMinimalRuntime(rawPorts, {
  maxRetries = 1,
  maxRestarts = 1,
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
} = {}) {
  const ports = assertRuntimePorts(rawPorts);

  async function persist(run) {
    run.updatedAt = now();
    await ports.runs.save(run);
  }

  async function emit(run, event, details = {}) {
    run.events.push({
      event,
      runId: run.runId,
      providerRunId: run.providerRunId,
      objectiveId: run.objectiveId,
      timestamp: now(),
      ...clone(details),
    });
    await persist(run);
  }

  async function executeStep(run, step) {
    const confirmation = step.confirmation;
    const confirmationId = confirmation?.id ? String(confirmation.id) : null;
    const confirmed = confirmationId && run.confirmations.includes(confirmationId);
    if (confirmation?.required && !confirmed) {
      step.status = 'AWAITING_CONFIRMATION';
      run.state = 'WAITING_CONFIRMATION';
      await emit(run, 'confirmation_wait_started', {
        stepId: step.id,
        confirmationId,
        payload: clone(confirmation.payload ?? null),
      });
      return false;
    }

    const authorization = await ports.policy.authorize({ run: clone(run), step: clone(step) });
    if (!authorization?.allowed) {
      step.status = 'AWAITING_APPROVAL';
      run.state = 'WAITING_APPROVAL';
      await emit(run, 'approval_wait_started', {
        stepId: step.id,
        tool: step.action?.tool ?? null,
        risk: step.action?.risk ?? null,
        reason: authorization?.reason ?? 'approval-required',
      });
      return false;
    }

    step.status = 'RUNNING';
    await emit(run, 'internal_step_started', { stepId: step.id, tool: step.action?.tool ?? null });

    let retries = 0;
    let restarts = 0;

    while (true) {
      const result = await ports.execution.run({
        run: clone(run),
        step: clone(step),
        providerRunId: run.providerRunId,
        retry: retries,
        restart: restarts,
      });
      addUsage(run.usage, result?.usage);

      if (result?.ok) {
        const outputCheck = validateRequiredOutputs(step.requiredOutputs, result.files);
        if (!outputCheck.ok) {
          step.status = 'FAILED';
          run.state = 'FAILED';
          await emit(run, 'required_output_missing', {
            stepId: step.id,
            missing: outputCheck.missing,
          });
          return false;
        }

        step.status = 'COMPLETED';
        step.output = clone(result?.output ?? null);
        step.files = clone(result?.files ?? {});
        await emit(run, 'internal_step_completed', {
          stepId: step.id,
          usage: normalizedUsage(result?.usage),
          files: Object.keys(result?.files ?? {}),
        });
        return true;
      }

      if (result?.restartRequired && restarts < maxRestarts) {
        restarts += 1;
        run.restartCount += 1;
        run.providerRunId = idFactory();
        await emit(run, 'provider_run_restarted', {
          stepId: step.id,
          restart: restarts,
          reason: result?.reason ?? 'restart-required',
        });
        continue;
      }

      if (result?.retryable && retries < maxRetries) {
        retries += 1;
        run.retryCount += 1;
        await emit(run, 'provider_run_retry', {
          stepId: step.id,
          retry: retries,
          reason: result?.reason ?? 'retryable-failure',
        });
        continue;
      }

      step.status = 'FAILED';
      run.state = 'FAILED';
      await emit(run, 'internal_step_failed', {
        stepId: step.id,
        reason: result?.reason ?? 'execution-failed',
      });
      return false;
    }
  }

  async function drive(run) {
    if (terminalStates.has(run.state)) return run;
    run.state = 'RUNNING';
    await emit(run, 'run_started');

    for (const step of run.plan.steps) {
      if (step.status === 'COMPLETED') continue;
      const advanced = await executeStep(run, step);
      if (!advanced) return run;
    }

    run.state = 'COMPLETED';
    await emit(run, 'objective_completed', {
      usage: clone(run.usage),
      retryCount: run.retryCount,
      restartCount: run.restartCount,
    });
    return run;
  }

  return {
    async start(input) {
      if (!input?.title?.trim()) throw new Error('objective title is required');
      const objectiveId = input.id ?? idFactory();
      const runId = idFactory();
      const plan = await ports.planner.plan({
        id: objectiveId,
        title: input.title.trim(),
        description: String(input.description ?? '').trim(),
      });
      if (!Array.isArray(plan?.steps)) throw new Error('planner must return steps');

      const run = {
        objectiveId,
        runId,
        providerRunId: idFactory(),
        title: input.title.trim(),
        description: String(input.description ?? '').trim(),
        state: 'PLANNED',
        approvals: [],
        confirmations: [],
        plan: clone(plan),
        usage: { tokens: 0, cost: 0 },
        retryCount: 0,
        restartCount: 0,
        events: [],
        createdAt: now(),
        updatedAt: now(),
      };
      await ports.runs.save(run);
      await emit(run, 'objective_persisted');
      return clone(await drive(run));
    },

    async confirm(objectiveId, confirmationId) {
      const run = await ports.runs.get(objectiveId);
      if (!run) throw new Error('objective not found: ' + objectiveId);
      const value = String(confirmationId ?? '').trim();
      if (!value) throw new Error('confirmation id is required');
      const step = run.plan.steps.find((candidate) => candidate.status === 'AWAITING_CONFIRMATION' && String(candidate.confirmation?.id ?? '') === value);
      if (!step) { const error = new Error('confirmation is not pending: ' + value); error.code = 'CONFIRMATION_MISMATCH'; throw error; }
      if (!run.confirmations.includes(value)) run.confirmations.push(value);
      step.status = 'PENDING';
      run.state = 'PLANNED';
      await emit(run, 'confirmation_received', { confirmationId: value, stepId: step.id });
      return clone(await drive(run));
    },

    async approve(objectiveId, tool) {
      const run = await ports.runs.get(objectiveId);
      if (!run) throw new Error('objective not found: ' + objectiveId);
      if (!tool?.trim()) throw new Error('tool approval is required');
      if (!run.approvals.includes(tool.trim())) run.approvals.push(tool.trim());
      for (const step of run.plan.steps) {
        if (step.status === 'AWAITING_APPROVAL' && step.action?.tool === tool.trim()) step.status = 'PENDING';
      }
      run.state = 'PLANNED';
      await emit(run, 'approval_received', { tool: tool.trim() });
      return clone(await drive(run));
    },

    async resume(objectiveId) {
      const run = await ports.runs.get(objectiveId);
      if (!run) throw new Error('objective not found: ' + objectiveId);
      if (terminalStates.has(run.state)) return clone(run);
      await emit(run, 'run_resumed');
      return clone(await drive(run));
    },

    async status(objectiveId) {
      const run = await ports.runs.get(objectiveId);
      return run ? clone(run) : null;
    },
  };
}

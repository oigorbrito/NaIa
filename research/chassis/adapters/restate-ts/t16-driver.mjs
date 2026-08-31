import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as clients from '@restatedev/restate-sdk-clients';

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceScript = path.join(here, 't16-service-process.mjs');
const CANONICAL_MEANING = 'naia-t16-canonical';

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i += 2) out.set(argv[i], argv[i + 1]);
  return out;
}

function spawnService(variant, port, env) {
  const child = spawn(process.execPath, [serviceScript], {
    cwd: here,
    env: { ...env, NAIA_T16_RESTATE_VARIANT: variant, NAIA_T16_RESTATE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const state = { variant, port, child, pid: child.pid ?? null, events: [], waiters: [], stderr: '', exit: null };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let event;
    try { event = JSON.parse(line); } catch { event = { event: 'unparseable_stdout', raw: line }; }
    state.events.push(event);
    for (const waiter of [...state.waiters]) {
      if (waiter.predicate(event)) {
        state.waiters.splice(state.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      }
    }
  });
  child.once('exit', (code, signal) => {
    state.exit = { code, signal };
    for (const waiter of [...state.waiters]) {
      state.waiters.splice(state.waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Restate T16 service ${variant} exited before expected event: code=${code} signal=${signal}; stderr=${state.stderr}`));
    }
    rl.close();
  });
  return state;
}

function waitForEvent(state, predicate, timeoutMs, description) {
  const existing = state.events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      state.waiters.splice(state.waiters.indexOf(waiter), 1);
      reject(new Error(`Restate T16 service ${state.variant} did not emit ${description}; stderr=${state.stderr}`));
    }, timeoutMs);
    state.waiters.push(waiter);
  });
}

async function closeService(state) {
  if (!state || state.exit) return;
  state.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!state.exit) state.child.kill('SIGKILL');
      resolve();
    }, 3000);
    state.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function adminRequest(adminUrl, method, pathname, body) {
  const response = await fetch(`${adminUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!response.ok) throw new Error(`Restate Admin ${method} ${pathname} failed ${response.status}: ${text}`);
  return { status: response.status, headers: Object.fromEntries(response.headers), body: parsed };
}

function deploymentId(registration) {
  const body = registration?.body ?? {};
  const fromBody = body.id ?? body.deployment_id ?? body.deploymentId ?? null;
  if (fromBody) return fromBody;
  const location = registration?.headers?.location ?? null;
  return location ? location.split('/').filter(Boolean).at(-1) : null;
}

export async function runRestateT16({
  objectiveId = `naia-restate-t16-${randomUUID()}`,
  adminUrl = process.env.RESTATE_ADMIN_URL ?? 'http://127.0.0.1:9070',
  ingressUrl = process.env.RESTATE_INGRESS_URL ?? 'http://127.0.0.1:8080',
  portA = Number(process.env.NAIA_T16_RESTATE_PORT_A ?? '9181'),
  portB = Number(process.env.NAIA_T16_RESTATE_PORT_B ?? '9182'),
  timeoutMs = Number(process.env.NAIA_T16_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T16 timeout must be a positive number');
  if (portA === portB) throw new Error('Restate T16 deployment ports must differ');

  const schedule = [];
  let serviceA = null;
  let serviceB = null;
  let deploymentA = null;
  let deploymentB = null;
  let submission = null;
  const ingress = clients.connect({ url: ingressUrl });
  const client = ingress.workflowClient({ name: 'NaIaT16' }, objectiveId);

  try {
    serviceA = spawnService('A', portA, env);
    await waitForEvent(serviceA, (event) => event.event === 't16_service_ready', timeoutMs, 'service ready');
    schedule.push('deployment-A-service-ready');

    const registrationA = await adminRequest(adminUrl, 'POST', '/deployments', { uri: `http://127.0.0.1:${portA}` });
    deploymentA = deploymentId(registrationA);
    if (!deploymentA) throw new Error('Restate T16 deployment A registration did not expose deployment identity');
    schedule.push('deployment-A-registered');

    submission = await client.workflowSubmit({ objectiveId, holdMs: 5000 });
    const invocationId = submission.invocationId;
    if (!invocationId) throw new Error('Restate T16 workflowSubmit did not return invocationId');
    await waitForEvent(serviceA, (event) => event.event === 't16_checkpoint_observed' && event.objectiveId === objectiveId, timeoutMs, 'durable checkpoint observation');
    schedule.push('durable-checkpoint-under-A');

    await adminRequest(adminUrl, 'PATCH', `/invocations/${encodeURIComponent(invocationId)}/pause`);
    schedule.push('invocation-paused');

    serviceB = spawnService('B', portB, env);
    await waitForEvent(serviceB, (event) => event.event === 't16_service_ready', timeoutMs, 'service ready');
    schedule.push('deployment-B-service-ready');

    const registrationB = await adminRequest(adminUrl, 'POST', '/deployments', { uri: `http://127.0.0.1:${portB}` });
    deploymentB = deploymentId(registrationB);
    if (!deploymentB) throw new Error('Restate T16 deployment B registration did not expose deployment identity');
    if (deploymentA === deploymentB) throw new Error('Restate T16 semantic mutation requires distinct deployment identities');
    schedule.push('deployment-B-registered');

    const resume = await adminRequest(adminUrl, 'PATCH', `/invocations/${encodeURIComponent(invocationId)}/resume?deployment=latest`);
    schedule.push('resume-explicitly-routed-to-latest');

    const result = await ingress.result(submission);
    schedule.push('final-result-inspected');

    const finalOutput = await client.workflowOutput();
    const canonicalMeaningPreserved = result?.canonicalMeaning === CANONICAL_MEANING;
    const expectedSchedule = [
      'deployment-A-service-ready',
      'deployment-A-registered',
      'durable-checkpoint-under-A',
      'invocation-paused',
      'deployment-B-service-ready',
      'deployment-B-registered',
      'resume-explicitly-routed-to-latest',
      'final-result-inspected'
    ];

    return {
      objectiveIdentity: objectiveId,
      semanticMutation: { dimension: 'deploymentId', before: deploymentA, after: deploymentB },
      durableCheckpointBeforeMutation: true,
      recoveryAttemptedUnderMutatedProfile: true,
      compatibilityDisposition: {
        kind: 'ROUTED_TO_COMPATIBLE',
        explicit: resume.status === 200,
        migrationIdentity: `restate-resume-latest:${deploymentB}`
      },
      silentSemanticChangeObserved: !canonicalMeaningPreserved,
      priorMeaningPreservedOrExplicitlyMigrated: canonicalMeaningPreserved,
      durableAuthorityAlive: Boolean(finalOutput),
      deterministicScheduleObserved: JSON.stringify(schedule) === JSON.stringify(expectedSchedule),
      rawNativeEvidence: {
        objectiveId,
        invocationId,
        deploymentA,
        deploymentB,
        schedule,
        result,
        finalOutput,
        serviceA: { pid: serviceA.pid, events: serviceA.events, stderr: serviceA.stderr },
        serviceB: { pid: serviceB.pid, events: serviceB.events, stderr: serviceB.stderr }
      }
    };
  } finally {
    await Promise.all([closeService(serviceA), closeService(serviceB)]);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runRestateT16();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'RESTATE_T16_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}

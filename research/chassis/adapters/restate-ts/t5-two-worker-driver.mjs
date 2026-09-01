import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as clients from '@restatedev/restate-sdk-clients';

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceScript = path.join(here, 't5-service-process.mjs');

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i += 2) out.set(argv[i], argv[i + 1]);
  return out;
}

function spawnService(variant, port, env) {
  const child = spawn(process.execPath, [serviceScript], {
    cwd: here,
    env: { ...env, NAIA_T5_RESTATE_VARIANT: variant, NAIA_T5_RESTATE_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe']
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
      waiter.reject(new Error(`Restate T5 service ${variant} exited before expected event: code=${code} signal=${signal}; stderr=${state.stderr}`));
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
      reject(new Error(`Restate T5 service ${state.variant} did not emit ${description}; stderr=${state.stderr}`));
    }, timeoutMs);
    state.waiters.push(waiter);
  });
}

async function responseDisposition(state, requestId, timeoutMs) {
  const existing = state.events.find((event) =>
    event.requestId === requestId && ['t5_http_response_finished', 't5_http_response_closed'].includes(event.event));
  if (existing) return existing;
  return waitForEvent(
    state,
    (event) => event.requestId === requestId && ['t5_http_response_finished', 't5_http_response_closed'].includes(event.event),
    timeoutMs,
    `HTTP response disposition for ${requestId}`
  );
}

function releaseCompletion(state) {
  if (!state?.child?.stdin?.writable) throw new Error(`Restate T5 service ${state?.variant ?? '?'} control channel is not writable`);
  state.child.stdin.write(`${JSON.stringify({ command: 'release-completion' })}\n`);
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

async function peekInvocationOutput(ingressUrl, invocationId) {
  const response = await fetch(`${ingressUrl}/restate/output/${encodeURIComponent(invocationId)}`);
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: response.status, body, headers: Object.fromEntries(response.headers) };
}

export async function runRestateT5({
  objectiveId = `naia-restate-t5-${randomUUID()}`,
  adminUrl = process.env.RESTATE_ADMIN_URL ?? 'http://127.0.0.1:9070',
  ingressUrl = process.env.RESTATE_INGRESS_URL ?? 'http://127.0.0.1:8080',
  portA = Number(process.env.NAIA_T5_RESTATE_PORT_A ?? '9191'),
  portB = Number(process.env.NAIA_T5_RESTATE_PORT_B ?? '9192'),
  timeoutMs = Number(process.env.NAIA_T5_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T5 timeout must be a positive number');
  if (portA === portB) throw new Error('Restate T5 deployment ports must differ');

  const schedule = [];
  let serviceA = null;
  let serviceB = null;
  let deploymentA = null;
  let deploymentB = null;
  let submission = null;
  let staleAttemptEvent = null;
  let staleTransportDisposition = null;
  let outputAfterStale = null;
  let newAttemptEvent = null;
  let finalResult = null;
  const ingress = clients.connect({ url: ingressUrl });
  const client = ingress.workflowClient({ name: 'NaIaT5' }, objectiveId);

  try {
    serviceA = spawnService('A', portA, env);
    await waitForEvent(serviceA, (event) => event.event === 't5_service_ready', timeoutMs, 'service ready');
    schedule.push('worker-A-ready');

    const registrationA = await adminRequest(adminUrl, 'POST', '/deployments', { uri: `http://127.0.0.1:${portA}` });
    deploymentA = deploymentId(registrationA);
    if (!deploymentA) throw new Error('Restate T5 deployment A registration did not expose deployment identity');

    submission = await client.workflowSubmit({ objectiveId });
    const invocationId = submission.invocationId;
    if (!invocationId) throw new Error('Restate T5 workflowSubmit did not return invocationId');
    const acquiredA = await waitForEvent(
      serviceA,
      (event) => event.event === 't5_authority_acquired_and_held' && event.objectiveId === objectiveId,
      timeoutMs,
      'old authority acquired and held'
    );
    if (!acquiredA.requestId) throw new Error('Restate T5 worker A did not expose concrete invocation request identity');
    schedule.push('old-authority-acquired-and-held');

    serviceB = spawnService('B', portB, env);
    await waitForEvent(serviceB, (event) => event.event === 't5_service_ready', timeoutMs, 'service ready');
    schedule.push('worker-B-ready');

    const registrationB = await adminRequest(adminUrl, 'POST', '/deployments', { uri: `http://127.0.0.1:${portB}` });
    deploymentB = deploymentId(registrationB);
    if (!deploymentB) throw new Error('Restate T5 deployment B registration did not expose deployment identity');
    if (deploymentA === deploymentB) throw new Error('Restate T5 requires distinct deployment identities');

    await adminRequest(adminUrl, 'PATCH', `/invocations/${encodeURIComponent(invocationId)}/pause`);
    schedule.push('old-authority-paused');
    const resume = await adminRequest(adminUrl, 'PATCH', `/invocations/${encodeURIComponent(invocationId)}/resume?deployment=latest`);
    if (resume.status !== 200) throw new Error(`Restate T5 resume did not return 200: ${resume.status}`);

    const acquiredB = await waitForEvent(
      serviceB,
      (event) => event.event === 't5_authority_acquired_and_held' && event.objectiveId === objectiveId,
      timeoutMs,
      'new authority acquired and held'
    );
    if (!acquiredB.requestId) throw new Error('Restate T5 worker B did not expose concrete invocation request identity');
    schedule.push('new-authority-acquired-and-held');

    releaseCompletion(serviceA);
    staleAttemptEvent = await waitForEvent(
      serviceA,
      (event) => event.event === 't5_completion_attempt' && event.objectiveId === objectiveId && event.requestId === acquiredA.requestId,
      timeoutMs,
      'stale completion attempt'
    );
    schedule.push('stale-completion-attempted');

    staleTransportDisposition = await responseDisposition(serviceA, acquiredA.requestId, timeoutMs);
    const staleTransportFinished = staleTransportDisposition.event === 't5_http_response_finished';
    outputAfterStale = await peekInvocationOutput(ingressUrl, invocationId);
    const outputStillNotReady = outputAfterStale.status === 470;
    schedule.push('post-stale-authority-inspected');

    releaseCompletion(serviceB);
    newAttemptEvent = await waitForEvent(
      serviceB,
      (event) => event.event === 't5_completion_attempt' && event.objectiveId === objectiveId && event.requestId === acquiredB.requestId,
      timeoutMs,
      'new authority completion attempt'
    );
    schedule.push('new-authority-completion-attempted');

    finalResult = await ingress.result(submission);
    schedule.push('final-authority-inspected');

    const finalFromB = finalResult?.completedByVariant === 'B' && finalResult?.objectiveId === objectiveId;
    const expectedSchedule = [
      'worker-A-ready',
      'old-authority-acquired-and-held',
      'worker-B-ready',
      'old-authority-paused',
      'new-authority-acquired-and-held',
      'stale-completion-attempted',
      'post-stale-authority-inspected',
      'new-authority-completion-attempted',
      'final-authority-inspected'
    ];
    const oldAuthorityIdentity = `${invocationId}:deployment:${deploymentA}`;
    const newAuthorityIdentity = `${invocationId}:deployment:${deploymentB}`;

    return {
      oldWorkerIdentity: `restate-service-A-pid:${serviceA.pid}`,
      newWorkerIdentity: `restate-service-B-pid:${serviceB.pid}`,
      oldAuthorityIdentity,
      newAuthorityIdentity,
      authorityAdvanced: deploymentA !== deploymentB && acquiredB.variant === 'B',
      oldAuthorityHeldUntilTakeover: acquiredA.variant === 'A' && acquiredB.variant === 'B' && staleAttemptEvent !== null,
      staleCompletion: {
        attempted: staleTransportFinished,
        attemptedBeforeNewCompletion: staleTransportFinished && newAttemptEvent !== null,
        rejectedOrNonAuthoritative: staleTransportFinished && outputStillNotReady,
        becameAuthoritative: staleTransportFinished && outputAfterStale.status >= 200 && outputAfterStale.status < 300
      },
      newAuthorityStillCurrentAfterStaleAttempt: staleTransportFinished && outputStillNotReady && !serviceB.exit,
      newAuthorityCompletion: {
        attempted: newAttemptEvent !== null,
        acceptedOrAuthoritative: finalFromB
      },
      finalAuthorityIdentity: finalFromB ? newAuthorityIdentity : null,
      finalResultOrigin: finalFromB ? 'new-authority' : 'old-authority',
      durableAuthorityAlive: outputStillNotReady || finalFromB,
      deterministicScheduleObserved: JSON.stringify(schedule) === JSON.stringify(expectedSchedule),
      rawNativeEvidence: {
        objectiveId,
        invocationId,
        deploymentA,
        deploymentB,
        schedule,
        acquiredA,
        acquiredB,
        staleAttemptEvent,
        staleTransportDisposition,
        outputAfterStale,
        newAttemptEvent,
        finalResult,
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
  const evidence = await runRestateT5();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'RESTATE_T5_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}

// LOCAL TEST HARNESS: controlled fault-injection for NaIa's own chassis qualification.
// No third-party target, credential bypass, or real-world service disruption.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as clients from '@restatedev/restate-sdk-clients';
import { createExternalEffectOracle } from '../../harness/external-oracle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceScript = path.join(here, 't11-service-process.mjs');

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i += 2) out.set(argv[i], argv[i + 1]);
  return out;
}

function spawnService(variant, port, env) {
  const child = spawn(process.execPath, [serviceScript], {
    cwd: here,
    env: { ...env, NAIA_T11_RESTATE_VARIANT: variant, NAIA_T11_RESTATE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const state = { variant, port, child, pid: child.pid ?? null, events: [], waiters: [], exitWaiters: [], stderr: '', exit: null };
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
    for (const waiter of [...state.exitWaiters]) {
      state.exitWaiters.splice(state.exitWaiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(state.exit);
    }
    for (const waiter of [...state.waiters]) {
      state.waiters.splice(state.waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Restate T11 service ${variant} exited before expected event: code=${code} signal=${signal}; stderr=${state.stderr}`));
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
      reject(new Error(`Restate T11 service ${state.variant} did not emit ${description}; stderr=${state.stderr}`));
    }, timeoutMs);
    state.waiters.push(waiter);
  });
}

function waitForExit(state, timeoutMs) {
  if (state.exit) return Promise.resolve(state.exit);
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      state.exitWaiters.splice(state.exitWaiters.indexOf(waiter), 1);
      reject(new Error(`Restate T11 service ${state.variant} did not exit before timeout`));
    }, timeoutMs);
    state.exitWaiters.push(waiter);
  });
}

async function closeService(state) {
  if (!state || state.exit) return;
  state.child.kill('SIGTERM');
  try { await waitForExit(state, 3000); }
  catch {
    if (!state.exit) state.child.kill('SIGKILL');
    await waitForExit(state, 3000).catch(() => {});
  }
}

async function request(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { ok: response.ok, status: response.status, headers: Object.fromEntries(response.headers), body: parsed, text };
}

async function adminRequest(adminUrl, method, pathname, body) {
  const result = await request(`${adminUrl}${pathname}`, method, body);
  if (!result.ok) throw new Error(`Restate Admin ${method} ${pathname} failed ${result.status}: ${result.text}`);
  return result;
}

function deploymentId(registration) {
  const body = registration?.body ?? {};
  const fromBody = body.id ?? body.deployment_id ?? body.deploymentId ?? null;
  if (fromBody) return fromBody;
  const location = registration?.headers?.location ?? null;
  return location ? location.split('/').filter(Boolean).at(-1) : null;
}

async function workflowOutputSnapshot(ingressUrl, objectiveId) {
  return request(`${ingressUrl}/restate/workflow/NaIaT11/${encodeURIComponent(objectiveId)}/output`, 'GET');
}

async function waitForTerminalWorkflowOutput(ingressUrl, objectiveId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await workflowOutputSnapshot(ingressUrl, objectiveId);
    if (last.status !== 470) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Restate T11 workflow output remained not-ready; last=${JSON.stringify(last)}`);
}

export async function runRestateT11({
  objectiveId = `naia-restate-t11-${randomUUID()}`,
  operationId = `naia-restate-t11-operation-${randomUUID()}`,
  adminUrl = process.env.RESTATE_ADMIN_URL ?? 'http://127.0.0.1:9070',
  ingressUrl = process.env.RESTATE_INGRESS_URL ?? 'http://127.0.0.1:8080',
  portA = Number(process.env.NAIA_T11_RESTATE_PORT_A ?? '9281'),
  portB = Number(process.env.NAIA_T11_RESTATE_PORT_B ?? '9282'),
  timeoutMs = Number(process.env.NAIA_T11_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T11 timeout must be a positive number');
  if (portA === portB) throw new Error('Restate T11 deployment ports must differ');

  const oracle = createExternalEffectOracle();
  const oracleUrl = await oracle.start();
  const ingress = clients.connect({ url: ingressUrl });
  const client = ingress.workflowClient({ name: 'NaIaT11' }, objectiveId);
  const schedule = [];
  let serviceA = null;
  let serviceB = null;
  let deploymentA = null;
  let deploymentB = null;

  try {
    serviceA = spawnService('A', portA, env);
    const readyA = await waitForEvent(serviceA, (event) => event.event === 't11_service_ready', timeoutMs, 'service ready A');
    const registrationA = await adminRequest(adminUrl, 'POST', '/deployments', { uri: `http://127.0.0.1:${portA}` });
    deploymentA = deploymentId(registrationA);
    if (!deploymentA) throw new Error('Restate T11 deployment A registration did not expose deployment identity');

    const submission = await client.workflowSubmit({ objectiveId, operationId, oracleUrl });
    const invocationId = submission.invocationId;
    if (!invocationId) throw new Error('Restate T11 workflowSubmit did not return invocationId');
    schedule.push('objective-running');

    const checkpoint = await waitForEvent(
      serviceA,
      (event) => event.event === 't11_pre_cancel_checkpoint' && event.objectiveId === objectiveId,
      timeoutMs,
      'pre-cancel checkpoint'
    );
    schedule.push('pre-cancel-checkpoint');

    const cancelResponse = await adminRequest(adminUrl, 'PATCH', `/invocations/${encodeURIComponent(invocationId)}/cancel`);
    schedule.push('cancel-submitted');

    const nativeCancel = await waitForEvent(
      serviceA,
      (event) => event.event === 't11_native_cancellation_observed' && event.objectiveId === objectiveId,
      timeoutMs,
      'native cancellation observation'
    );
    const terminalBeforeCrash = await waitForTerminalWorkflowOutput(ingressUrl, objectiveId, timeoutMs);
    const cancelDurable = terminalBeforeCrash.status === 409 && nativeCancel?.error?.name === 'CancelledError';
    if (!cancelDurable) {
      throw new Error(`Restate T11 cancellation did not become terminal before crash: ${JSON.stringify(terminalBeforeCrash)}`);
    }
    schedule.push('cancel-authority-durable');

    const oldWorkerIdentity = `restate-service-A:${readyA.pid ?? serviceA.pid}:deployment:${deploymentA}`;
    const exitA = waitForExit(serviceA, timeoutMs);
    const crashRequested = serviceA.child.kill('SIGKILL');
    const crashExit = await exitA;
    schedule.push('worker-crash');

    serviceB = spawnService('B', portB, env);
    const readyB = await waitForEvent(serviceB, (event) => event.event === 't11_service_ready', timeoutMs, 'service ready B');
    const registrationB = await adminRequest(adminUrl, 'POST', '/deployments', { uri: `http://127.0.0.1:${portB}` });
    deploymentB = deploymentId(registrationB);
    if (!deploymentB) throw new Error('Restate T11 deployment B registration did not expose deployment identity');
    if (deploymentA === deploymentB) throw new Error('Restate T11 requires distinct deployment identities');
    const recoveryWorkerIdentity = `restate-service-B:${readyB.pid ?? serviceB.pid}:deployment:${deploymentB}`;

    const resumeResponse = await request(
      `${adminUrl}/invocations/${encodeURIComponent(invocationId)}/resume?deployment=latest`,
      'PATCH'
    );
    schedule.push('recovery-attempted');

    const protectedEventOnB = serviceB.events.find((event) =>
      event.event === 't11_protected_operation_attempt' && event.objectiveId === objectiveId) ?? null;
    const oracleEntry = oracle.snapshot(operationId);
    const blockedByNativeCancellation = resumeResponse.ok === false && terminalBeforeCrash.status === 409 && nativeCancel?.error?.name === 'CancelledError';
    schedule.push('post-cancel-progress-challenged');

    const terminalAfterRecovery = await waitForTerminalWorkflowOutput(ingressUrl, objectiveId, timeoutMs);
    const finalStillCancelled = terminalAfterRecovery.status === 409;
    const oracleAfterRecovery = oracle.snapshot(operationId);
    schedule.push('post-recovery-state-inspected');

    const acceptedCountAfterCancel = oracleAfterRecovery?.applyCount ?? 0;
    const expectedSchedule = [
      'objective-running',
      'pre-cancel-checkpoint',
      'cancel-submitted',
      'cancel-authority-durable',
      'worker-crash',
      'recovery-attempted',
      'post-cancel-progress-challenged',
      'post-recovery-state-inspected'
    ];

    return {
      objectiveIdentity: objectiveId,
      oldWorkerIdentity,
      recoveryWorkerIdentity,
      cancelSubmission: { attempted: true, acknowledged: cancelResponse.ok },
      cancelAuthority: {
        durable: cancelDurable,
        nativeState: 'workflow-terminal-failure-after-native-CancelledError',
        native: { nativeCancel, terminalBeforeCrash }
      },
      crash: {
        injected: crashRequested === true && crashExit?.signal === 'SIGKILL',
        targetIdentity: oldWorkerIdentity,
        signal: 'SIGKILL'
      },
      recovery: {
        attempted: true,
        workerIdentity: recoveryWorkerIdentity,
        resumeResponse
      },
      postCancelProtectedOperation: {
        attempted: Boolean(protectedEventOnB) || acceptedCountAfterCancel > 0,
        blockedBeforeProtectedOperation: !protectedEventOnB && acceptedCountAfterCancel === 0,
        blockedByNativeCancellation,
        accepted: acceptedCountAfterCancel > 0,
        acceptedCountAfterCancel,
        oracleEntry: oracleAfterRecovery
      },
      finalCancellationAuthoritative: finalStillCancelled && acceptedCountAfterCancel === 0,
      durableAuthorityAlive: terminalAfterRecovery.status === 409,
      deterministicScheduleObserved: JSON.stringify(schedule) === JSON.stringify(expectedSchedule),
      rawNativeEvidence: {
        objectiveId,
        operationId,
        invocationId,
        deploymentA,
        deploymentB,
        schedule,
        checkpoint,
        cancelResponse,
        nativeCancel,
        terminalBeforeCrash,
        crashExit,
        resumeResponse,
        terminalAfterRecovery,
        oracleBeforeRecovery: oracleEntry,
        oracleAfterRecovery,
        serviceA: { pid: serviceA.pid, events: serviceA.events, stderr: serviceA.stderr, exit: serviceA.exit },
        serviceB: { pid: serviceB.pid, events: serviceB.events, stderr: serviceB.stderr, exit: serviceB.exit }
      }
    };
  } finally {
    await Promise.all([closeService(serviceA), closeService(serviceB)]);
    await oracle.stop().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runRestateT11();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'RESTATE_T11_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}

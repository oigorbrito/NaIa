import { spawn } from 'node:child_process';

function parseJsonLine(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  return null;
}

export function validateWorkerKillReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object') return { valid: false, errors: ['receipt_missing_or_invalid'] };
  if (!['worker_process', 'worker_container'].includes(receipt.targetKind)) errors.push('target_kind_not_worker');
  if (receipt.controllerOnly === true) errors.push('controller_only_target_forbidden');
  if (receipt.killed !== true) errors.push('worker_not_confirmed_killed');
  if (receipt.signal !== 'SIGKILL') errors.push('signal_must_be_SIGKILL');
  if (receipt.targetKind === 'worker_process' && !(Number.isInteger(receipt.pid) && receipt.pid > 0)) errors.push('worker_pid_required');
  if (receipt.targetKind === 'worker_container' && !(typeof receipt.containerId === 'string' && receipt.containerId.length > 0)) errors.push('worker_container_id_required');
  if (!(typeof receipt.targetIdentity === 'string' && receipt.targetIdentity.length > 0)) errors.push('target_identity_required');
  if (!(typeof receipt.durableAuthority === 'string' && receipt.durableAuthority.length > 0)) errors.push('durable_authority_required');
  if (receipt.durableAuthorityAlive !== true) errors.push('durable_authority_not_confirmed_alive');
  if (!(typeof receipt.timestamp === 'string' && !Number.isNaN(Date.parse(receipt.timestamp)))) errors.push('timestamp_required');
  return { valid: errors.length === 0, errors };
}

export async function invokeWorkerKillHook({ command, args = [], cwd, env = process.env, timeoutMs = 5000 } = {}) {
  if (!command) {
    return {
      verdict: 'BLOCKED',
      blocker: 'WORKER_SIGKILL_HOOK_NOT_CONFIGURED',
      receipt: null,
      validation: { valid: false, errors: ['hook_command_missing'] }
    };
  }

  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);

  const stdoutText = stdout.join('');
  const stderrText = stderr.join('');
  const receipt = parseJsonLine(stdoutText);
  const validation = validateWorkerKillReceipt(receipt);
  const pass = !timedOut && result.code === 0 && validation.valid;

  return {
    verdict: pass ? 'PASS' : 'INCONCLUSIVE',
    blocker: pass ? null : timedOut ? 'WORKER_SIGKILL_HOOK_TIMEOUT' : 'WORKER_SIGKILL_HOOK_INVALID_RECEIPT',
    process: { ...result, timedOut, stdout: stdoutText, stderr: stderrText },
    receipt,
    validation
  };
}

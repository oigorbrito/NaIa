import { spawn } from 'node:child_process';
import readline from 'node:readline';

export async function runUntilKillpoint({
  command,
  args = [],
  cwd,
  env = process.env,
  killOnEvent,
  timeoutMs = 5000
}) {
  if (!killOnEvent) throw new Error('killOnEvent is required');

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const pid = child.pid ?? null;

  const events = [];
  const stderr = [];
  let killIssued = false;
  let timedOut = false;

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = { event: 'unparseable_stdout', raw: line };
    }
    events.push(parsed);

    if (!killIssued && parsed.event === killOnEvent) {
      killIssued = true;
      child.kill('SIGKILL');
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  clearTimeout(timer);
  rl.close();

  return {
    ...result,
    pid,
    killIssued,
    timedOut,
    events,
    stderr: stderr.join('')
  };
}

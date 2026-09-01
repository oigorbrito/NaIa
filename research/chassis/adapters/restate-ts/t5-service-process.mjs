import http from 'node:http';
import readline from 'node:readline';
import * as restate from '@restatedev/restate-sdk';
import { releaseT5Completion, withT5RequestContext } from './t5-control.mjs';
import { t5Workflow } from './t5-workflow.mjs';

const variant = process.env.NAIA_T5_RESTATE_VARIANT ?? 'A';
const port = Number(process.env.NAIA_T5_RESTATE_PORT ?? '9191');
if (!['A', 'B'].includes(variant)) throw new Error('NAIA_T5_RESTATE_VARIANT must be A or B');
if (!Number.isInteger(port) || port <= 0) throw new Error('NAIA_T5_RESTATE_PORT must be a positive integer');

const handler = restate.createEndpointHandler({ services: [t5Workflow] });
let nextRequestId = 1;

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    event,
    variant,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    ...fields
  })}\n`);
}

const server = http.createServer((req, res) => {
  const requestId = `${variant}-http-${nextRequestId++}`;
  const url = req.url ?? null;
  let finished = false;
  emit('t5_http_request_started', { requestId, method: req.method ?? null, url });
  res.once('finish', () => {
    finished = true;
    emit('t5_http_response_finished', { requestId, url, statusCode: res.statusCode });
  });
  res.once('close', () => {
    emit('t5_http_response_closed', { requestId, url, statusCode: res.statusCode, finished });
  });
  withT5RequestContext({ requestId, url }, () => handler(req, res));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '0.0.0.0', resolve);
});
emit('t5_service_ready', { port });

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let command;
  try { command = JSON.parse(line); } catch { command = { command: line.trim() }; }
  if (command?.command !== 'release-completion') {
    emit('t5_unknown_control_command', { command });
    return;
  }
  const released = releaseT5Completion();
  emit('t5_completion_release_received', { released });
});

async function close() {
  rl.close();
  await new Promise((resolve) => server.close(() => resolve()));
}

process.on('SIGTERM', () => close().finally(() => process.exit(0)));
process.on('SIGINT', () => close().finally(() => process.exit(0)));

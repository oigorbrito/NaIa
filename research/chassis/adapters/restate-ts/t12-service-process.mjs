import http from 'node:http';
import readline from 'node:readline';
import * as restate from '@restatedev/restate-sdk';
import { releaseT12Completion, withT12RequestContext } from './t12-control.mjs';
import { t12Workflow } from './t12-workflow.mjs';

const variant = process.env.NAIA_T12_RESTATE_VARIANT ?? 'A';
const port = Number(process.env.NAIA_T12_RESTATE_PORT ?? '9291');
if (!['A', 'B'].includes(variant)) throw new Error('NAIA_T12_RESTATE_VARIANT must be A or B');
if (!Number.isInteger(port) || port <= 0) throw new Error('NAIA_T12_RESTATE_PORT must be a positive integer');

const handler = restate.createEndpointHandler({ services: [t12Workflow] });
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
  emit('t12_http_request_started', { requestId, method: req.method ?? null, url });
  res.once('finish', () => {
    finished = true;
    emit('t12_http_response_finished', { requestId, url, statusCode: res.statusCode });
  });
  res.once('close', () => {
    emit('t12_http_response_closed', { requestId, url, statusCode: res.statusCode, finished });
  });
  withT12RequestContext({ requestId, url }, () => handler(req, res));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '0.0.0.0', resolve);
});
emit('t12_service_ready', { port });

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let command;
  try { command = JSON.parse(line); } catch { command = { command: line.trim() }; }
  if (command?.command !== 'release-completion') {
    emit('t12_unknown_control_command', { command });
    return;
  }
  const released = releaseT12Completion();
  emit('t12_completion_release_received', { released });
});

async function close() {
  rl.close();
  await new Promise((resolve) => server.close(() => resolve()));
}

process.on('SIGTERM', () => close().finally(() => process.exit(0)));
process.on('SIGINT', () => close().finally(() => process.exit(0)));

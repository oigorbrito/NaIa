// LOCAL TEST HARNESS: controlled fault-injection for NaIa's own chassis qualification.
// No third-party target, credential bypass, or real-world service disruption.
import http from 'node:http';
import * as restate from '@restatedev/restate-sdk';
import { t11Workflow } from './t11-workflow.mjs';

const variant = process.env.NAIA_T11_RESTATE_VARIANT ?? 'A';
const port = Number(process.env.NAIA_T11_RESTATE_PORT ?? '9281');
if (!['A', 'B'].includes(variant)) throw new Error('NAIA_T11_RESTATE_VARIANT must be A or B');
if (!Number.isInteger(port) || port <= 0) throw new Error('NAIA_T11_RESTATE_PORT must be a positive integer');

const handler = restate.createEndpointHandler({ services: [t11Workflow] });
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
  emit('t11_http_request_started', { requestId, method: req.method ?? null, url });
  res.once('finish', () => emit('t11_http_response_finished', { requestId, url, statusCode: res.statusCode }));
  res.once('close', () => emit('t11_http_response_closed', { requestId, url, statusCode: res.statusCode }));
  handler(req, res);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '0.0.0.0', resolve);
});
emit('t11_service_ready', { port });

async function close() {
  await new Promise((resolve) => server.close(() => resolve()));
}

process.on('SIGTERM', () => close().finally(() => process.exit(0)));
process.on('SIGINT', () => close().finally(() => process.exit(0)));

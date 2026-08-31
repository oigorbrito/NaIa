import http from 'node:http';
import * as restate from '@restatedev/restate-sdk';
import { t16WorkflowA } from './t16-workflow-a.mjs';
import { t16WorkflowB } from './t16-workflow-b.mjs';

const variant = process.env.NAIA_T16_RESTATE_VARIANT ?? 'A';
const port = Number(process.env.NAIA_T16_RESTATE_PORT ?? '9181');
if (!['A', 'B'].includes(variant)) throw new Error('NAIA_T16_RESTATE_VARIANT must be A or B');
if (!Number.isInteger(port) || port <= 0) throw new Error('NAIA_T16_RESTATE_PORT must be a positive integer');

const service = variant === 'A' ? t16WorkflowA : t16WorkflowB;
const handler = restate.createEndpointHandler({ services: [service] });
const server = http.createServer(handler);

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, variant, pid: process.pid, timestamp: new Date().toISOString(), ...fields })}\n`);
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '0.0.0.0', resolve);
});
emit('t16_service_ready', { port });

async function close() {
  await new Promise((resolve) => server.close(() => resolve()));
}

process.on('SIGTERM', () => close().finally(() => process.exit(0)));
process.on('SIGINT', () => close().finally(() => process.exit(0)));

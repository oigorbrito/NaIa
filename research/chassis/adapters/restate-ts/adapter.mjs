import http from 'node:http';
import * as restate from '@restatedev/restate-sdk';
import * as clients from '@restatedev/restate-sdk-clients';
import { naiaObjective } from './workflow.mjs';

const command = process.argv[2];
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const objectiveId = args.get('--objective-id');
const operationId = args.get('--operation-id');
const oracleUrl = args.get('--oracle-url');
const endpointPort = Number(process.env.NAIA_RESTATE_ENDPOINT_PORT ?? '9080');
const adminUrl = process.env.RESTATE_ADMIN_URL ?? 'http://127.0.0.1:9070';
const ingressUrl = process.env.RESTATE_INGRESS_URL ?? 'http://127.0.0.1:8080';
const publicEndpoint = process.env.NAIA_RESTATE_PUBLIC_ENDPOINT ?? `http://127.0.0.1:${endpointPort}`;

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({
    event,
    candidate: 'restate-ts-v1',
    objectiveId,
    attempt: Number(fields.attempt ?? 1),
    timestamp: new Date().toISOString(),
    ...fields
  }) + '\n');
}

function requireIdentity({ external = false } = {}) {
  if (!objectiveId) throw new Error('--objective-id is required');
  if (external && !operationId) throw new Error('--operation-id is required');
  if (external && !oracleUrl) throw new Error('--oracle-url is required');
}

async function startEndpoint() {
  const handler = restate.createEndpointHandler({ services: [naiaObjective] });
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpointPort, '0.0.0.0', resolve);
  });
  emit('adapter_ready', { endpointPort, publicEndpoint });
  return server;
}

async function closeEndpoint(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function registerDeployment() {
  const response = await fetch(`${adminUrl}/deployments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: publicEndpoint, use_http_11: true })
  });
  if (!response.ok) {
    throw new Error(`Restate deployment registration failed ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function workflowClient() {
  const ingress = clients.connect({ url: ingressUrl });
  return {
    ingress,
    client: ingress.workflowClient({ name: 'NaIaObjective' }, objectiveId)
  };
}

async function start() {
  requireIdentity({ external: true });
  const server = await startEndpoint();
  try {
    const deployment = await registerDeployment();
    const { ingress, client } = workflowClient();
    const submission = await client.workflowSubmit({ objectiveId, operationId, oracleUrl });
    emit('objective_persisted', { invocationId: submission.invocationId, deployment });
    const result = await ingress.result(submission);
    emit('objective_completed', { result });
  } finally {
    await closeEndpoint(server);
  }
}

async function resume() {
  requireIdentity({ external: true });
  const server = await startEndpoint();
  try {
    const { client } = workflowClient();
    emit('objective_persisted', { workflowId: objectiveId, recovered: true });
    const result = await client.workflowAttach();
    emit('objective_completed', { result });
  } finally {
    await closeEndpoint(server);
  }
}

async function status() {
  requireIdentity();
  const { client } = workflowClient();
  const output = await client.workflowOutput();
  console.log(JSON.stringify({
    objectiveId,
    state: output.ready ? 'COMPLETED' : 'RUNNING',
    currentAuthority: 'restate-server',
    operationId: operationId ?? null,
    native: output
  }));
}

async function main() {
  switch (command) {
    case 'start':
      await start();
      return;
    case 'resume':
      await resume();
      return;
    case 'status':
      await status();
      return;
    default:
      throw new Error(`unsupported command in T7/T8/T15 slice: ${command}`);
  }
}

main().catch((error) => {
  emit('fatal_error', { error: String(error) });
  process.exitCode = 1;
});

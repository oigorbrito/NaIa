#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createFilePorts } from './file-ports.mjs';
import { createNaiaService } from './service.mjs';
import { presentObjective } from './presenter.mjs';
import { createConnectorGateway } from './connectors.mjs';
import { createConnectorAwarePlanner } from './connector-planner.mjs';
import { createProviderAwarePlanner } from './provider-aware-planner.mjs';
import { planIntent } from './planner.mjs';
import { runInteractiveSession } from './interaction.mjs';
import { listProviderPacks } from './provider-packs.mjs';
import { assertProviderCapabilityManifest, createGatewayProviderPackCapabilities, providerCapabilitySchema } from './provider-pack-adapter.mjs';
import { validateWorkflowDefinition } from './workflows.mjs';

const [command = 'pursue', ...args] = process.argv.slice(2);
const rootDir = process.env.NAIA_DATA_DIR || '.naia';

async function loadExternalCapabilities() {
  const baseUrl = String(process.env.NAIA_CONNECTOR_GATEWAY_URL ?? '').trim();
  if (!baseUrl) return [];
  const gateway = createConnectorGateway({ baseUrl, token: process.env.NAIA_CONNECTOR_GATEWAY_TOKEN ?? '' });
  const manifest = await gateway.manifest();
  const compatibility = assertProviderCapabilityManifest(manifest);
  const compatibleNames = new Set(compatibility.filter((item) => item.available && item.compatible).map((item) => item.name));
  const canonical = createGatewayProviderPackCapabilities({ gateway }).filter((item) => compatibleNames.has(item.name));
  const canonicalNames = new Set(canonical.map((item) => item.name));
  const custom = manifest.filter((item) => !canonicalNames.has(item.name)).map((item) => ({
    ...item,
    async invoke(input, context) { return gateway.invoke(item.name, input, context); },
  }));
  return [...canonical, ...custom];
}

async function readWorkflow(path) {
  if (!path) throw new Error('workflow JSON path is required');
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  validateWorkflowDefinition(parsed);
  return parsed;
}

const externalCapabilities = await loadExternalCapabilities();
const connectorPlanner = createConnectorAwarePlanner({
  fallbackPlanner: { async plan(objective, context = {}) { return planIntent(objective, context); } },
});
const planner = createProviderAwarePlanner({ fallbackPlanner: connectorPlanner });
const ports = createFilePorts({ rootDir, capabilities: externalCapabilities, planner });
const naia = createNaiaService(ports);

function print(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function parseScopes(value = '') { return String(value).split(',').map((scope) => scope.trim()).filter(Boolean); }

if (command === 'pursue') {
  const title = args.join(' ').trim();
  if (!title) { console.error('Usage: npm run start:product -- pursue <objective>'); process.exitCode = 2; }
  else print(await naia.pursue({ title }));
} else if (command === 'workflow:validate') {
  const [path] = args;
  try { const workflow = await readWorkflow(path); print({ valid: true, id: workflow.id, steps: workflow.steps.length }); }
  catch (error) { console.error(error?.message ?? String(error)); process.exitCode = 2; }
} else if (command === 'workflow:run') {
  const [path, ...titleParts] = args;
  try {
    const workflow = await readWorkflow(path);
    const title = titleParts.join(' ').trim();
    print(await naia.runWorkflow(workflow, title ? { title } : {}));
  } catch (error) { console.error(error?.message ?? String(error)); process.exitCode = 2; }
} else if (command === 'resume') {
  const [objectiveId] = args;
  if (!objectiveId) { console.error('Usage: npm run start:product -- resume <objectiveId>'); process.exitCode = 2; }
  else print(await naia.resume(objectiveId));
} else if (command === 'approve') {
  const [objectiveId, capability] = args;
  if (!objectiveId || !capability) { console.error('Usage: npm run start:product -- approve <objectiveId> <capability>'); process.exitCode = 2; }
  else print(await naia.approve(objectiveId, capability));
} else if (command === 'show') {
  const [objectiveId] = args;
  if (!objectiveId) { console.error('Usage: npm run start:product -- show <objectiveId>'); process.exitCode = 2; }
  else print(await naia.get(objectiveId));
} else if (command === 'status') {
  const [objectiveId] = args;
  if (!objectiveId) { console.error('Usage: npm run start:product -- status <objectiveId>'); process.exitCode = 2; }
  else print(presentObjective(await naia.get(objectiveId)));
} else if (command === 'results') {
  const [objectiveId] = args;
  if (!objectiveId) { console.error('Usage: npm run start:product -- results <objectiveId>'); process.exitCode = 2; }
  else print(await naia.results(objectiveId));
} else if (command === 'history') {
  print(await naia.history());
} else if (command === 'tools' || command === 'capabilities') {
  print(naia.tools());
} else if (command === 'providers') {
  print(listProviderPacks());
} else if (command === 'schema') {
  const [capability] = args;
  if (!capability) { console.error('Usage: npm run start:product -- schema <capability>'); process.exitCode = 2; }
  else print(providerCapabilitySchema(capability));
} else if (command === 'connections') {
  print(await naia.connections());
} else if (command === 'connection:set') {
  const [provider, status, scopes = ''] = args;
  if (!provider || !status) {
    console.error('Usage: npm run start:product -- connection:set <provider> <CONNECTED|DISCONNECTED|PERMISSION_MISSING> [scope1,scope2]');
    process.exitCode = 2;
  } else {
    const grantedScopes = status === 'CONNECTED' ? parseScopes(scopes) : [];
    const missingScopes = status === 'PERMISSION_MISSING' ? parseScopes(scopes) : [];
    print(await naia.setConnection({ provider, status, grantedScopes, missingScopes }));
  }
} else if (command === 'session' || command === 'shell') {
  await runInteractiveSession({ naia });
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Commands: pursue, workflow:validate, workflow:run, resume, approve, show, status, results, history, capabilities, providers, schema, connections, connection:set, session');
  process.exitCode = 2;
}

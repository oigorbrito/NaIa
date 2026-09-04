#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createFilePorts } from './file-ports.mjs';
import { createNaiaService } from './service.mjs';
import { presentObjective } from './presenter.mjs';
import { presentAutomationProposal } from './automation-surface.mjs';
import { createAutomationPlanner } from './automation-planner.mjs';
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
  const custom = manifest.filter((item) => !canonicalNames.has(item.name)).map((item) => ({ ...item, async invoke(input, context) { return gateway.invoke(item.name, input, context); } }));
  return [...canonical, ...custom];
}

async function readJson(path, label = 'JSON') {
  if (!path) throw new Error(`${label} path is required`);
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readWorkflow(path) {
  const parsed = await readJson(path, 'workflow JSON');
  validateWorkflowDefinition(parsed);
  return parsed;
}

function parseJsonArg(value, fallback = {}) {
  if (!value) return fallback;
  const parsed = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('JSON argument must be an object');
  return parsed;
}

const externalCapabilities = await loadExternalCapabilities();
const connectorPlanner = createConnectorAwarePlanner({ fallbackPlanner: { async plan(objective, context = {}) { return planIntent(objective, context); } } });
const providerPlanner = createProviderAwarePlanner({ fallbackPlanner: connectorPlanner });
const planner = createAutomationPlanner({ fallbackPlanner: providerPlanner });
const ports = createFilePorts({ rootDir, capabilities: externalCapabilities, planner });
const naia = createNaiaService(ports);

function print(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function parseScopes(value = '') { return String(value).split(',').map((scope) => scope.trim()).filter(Boolean); }

if (command === 'pursue') {
  const title = args.join(' ').trim();
  if (!title) { console.error('Usage: npm run start:product -- pursue <objective>'); process.exitCode = 2; }
  else print(await naia.pursue({ title }));
} else if (command === 'automate' || command === 'propose') {
  const title = args.join(' ').trim();
  if (!title) { console.error('Usage: npm run start:product -- automate <request>'); process.exitCode = 2; }
  else print(presentAutomationProposal(await naia.propose({ title })));
} else if (command === 'proposal') {
  const [objectiveId] = args;
  if (!objectiveId) { console.error('Usage: npm run start:product -- proposal <objectiveId>'); process.exitCode = 2; }
  else print(presentAutomationProposal(await naia.proposal(objectiveId) ?? {}));
} else if (command === 'confirm') {
  const [objectiveId] = args;
  if (!objectiveId) { console.error('Usage: npm run start:product -- confirm <objectiveId>'); process.exitCode = 2; }
  else print(await naia.confirm(objectiveId));
} else if (command === 'automation:create') {
  const [path] = args;
  try { print(await naia.createAutomation(await readJson(path, 'automation JSON'))); }
  catch (error) { console.error(error?.message ?? String(error)); process.exitCode = 2; }
} else if (command === 'automations') {
  print(await naia.automations());
} else if (command === 'automation:show') {
  const [id] = args;
  if (!id) { console.error('Usage: npm run start:product -- automation:show <id>'); process.exitCode = 2; }
  else print(await naia.automation(id));
} else if (command === 'automation:enable' || command === 'automation:disable') {
  const [id] = args;
  if (!id) { console.error(`Usage: npm run start:product -- ${command} <id>`); process.exitCode = 2; }
  else print(await naia.setAutomationEnabled(id, command === 'automation:enable'));
} else if (command === 'automation:run') {
  const [id, paramsJson] = args;
  if (!id) { console.error('Usage: npm run start:product -- automation:run <id> [params-json]'); process.exitCode = 2; }
  else print(presentAutomationProposal(await naia.runAutomation(id, parseJsonArg(paramsJson))));
} else if (command === 'automation:trigger') {
  const [id, triggerJson, paramsJson] = args;
  if (!id || !triggerJson) { console.error('Usage: npm run start:product -- automation:trigger <id> <trigger-json> [params-json]'); process.exitCode = 2; }
  else print(presentAutomationProposal(await naia.triggerAutomation(id, parseJsonArg(triggerJson), parseJsonArg(paramsJson))));
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
  if (!provider || !status) { console.error('Usage: npm run start:product -- connection:set <provider> <CONNECTED|DISCONNECTED|PERMISSION_MISSING> [scope1,scope2]'); process.exitCode = 2; }
  else {
    const grantedScopes = status === 'CONNECTED' ? parseScopes(scopes) : [];
    const missingScopes = status === 'PERMISSION_MISSING' ? parseScopes(scopes) : [];
    print(await naia.setConnection({ provider, status, grantedScopes, missingScopes }));
  }
} else if (command === 'session' || command === 'shell') {
  await runInteractiveSession({ naia });
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Commands: pursue, automate, proposal, confirm, automation:create, automations, automation:show, automation:enable, automation:disable, automation:run, automation:trigger, workflow:validate, workflow:run, resume, approve, show, status, results, history, capabilities, providers, schema, connections, connection:set, session');
  process.exitCode = 2;
}

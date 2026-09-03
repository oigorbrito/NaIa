#!/usr/bin/env node
import { createFilePorts } from './file-ports.mjs';
import { createNaiaService } from './service.mjs';
import { presentObjective } from './presenter.mjs';
import { capabilitiesFromEnvironment } from './connectors.mjs';
import { createConnectorAwarePlanner } from './connector-planner.mjs';
import { planIntent } from './planner.mjs';
import { runInteractiveSession } from './interaction.mjs';
import { listProviderPacks } from './provider-packs.mjs';
import { providerCapabilitySchema } from './provider-pack-adapter.mjs';

const [command = 'pursue', ...args] = process.argv.slice(2);
const rootDir = process.env.NAIA_DATA_DIR || '.naia';
const externalCapabilities = await capabilitiesFromEnvironment(process.env);
const planner = createConnectorAwarePlanner({
  fallbackPlanner: {
    async plan(objective, context = {}) {
      return planIntent(objective, context);
    },
  },
});
const ports = createFilePorts({ rootDir, capabilities: externalCapabilities, planner });
const naia = createNaiaService(ports);

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (command === 'pursue') {
  const title = args.join(' ').trim();
  if (!title) {
    console.error('Usage: npm run start:product -- pursue <objective>');
    process.exitCode = 2;
  } else {
    print(await naia.pursue({ title }));
  }
} else if (command === 'resume') {
  const [objectiveId] = args;
  if (!objectiveId) {
    console.error('Usage: npm run start:product -- resume <objectiveId>');
    process.exitCode = 2;
  } else {
    print(await naia.resume(objectiveId));
  }
} else if (command === 'approve') {
  const [objectiveId, capability] = args;
  if (!objectiveId || !capability) {
    console.error('Usage: npm run start:product -- approve <objectiveId> <capability>');
    process.exitCode = 2;
  } else {
    print(await naia.approve(objectiveId, capability));
  }
} else if (command === 'show') {
  const [objectiveId] = args;
  if (!objectiveId) {
    console.error('Usage: npm run start:product -- show <objectiveId>');
    process.exitCode = 2;
  } else {
    print(await naia.get(objectiveId));
  }
} else if (command === 'status') {
  const [objectiveId] = args;
  if (!objectiveId) {
    console.error('Usage: npm run start:product -- status <objectiveId>');
    process.exitCode = 2;
  } else {
    print(presentObjective(await naia.get(objectiveId)));
  }
} else if (command === 'history') {
  print(await naia.history());
} else if (command === 'tools' || command === 'capabilities') {
  print(naia.tools());
} else if (command === 'providers') {
  print(listProviderPacks());
} else if (command === 'schema') {
  const [capability] = args;
  if (!capability) {
    console.error('Usage: npm run start:product -- schema <capability>');
    process.exitCode = 2;
  } else {
    print(providerCapabilitySchema(capability));
  }
} else if (command === 'session' || command === 'shell') {
  await runInteractiveSession({ naia });
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Commands: pursue, resume, approve, show, status, history, capabilities, providers, schema, session');
  process.exitCode = 2;
}

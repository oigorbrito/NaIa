#!/usr/bin/env node
import { createFilePorts } from './file-ports.mjs';
import { createNaiaService } from './service.mjs';
import { presentObjective } from './presenter.mjs';

const [command = 'pursue', ...args] = process.argv.slice(2);
const ports = createFilePorts({ rootDir: process.env.NAIA_DATA_DIR || '.naia' });
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
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Commands: pursue, resume, approve, show, status, history, capabilities');
  process.exitCode = 2;
}

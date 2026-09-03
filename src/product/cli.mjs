#!/usr/bin/env node
import { createFilePorts } from './file-ports.mjs';
import { createNaiaService } from './service.mjs';

const [command = 'pursue', ...args] = process.argv.slice(2);
const ports = createFilePorts({ rootDir: process.env.NAIA_DATA_DIR || '.naia' });
const naia = createNaiaService(ports);

if (command === 'pursue') {
  const title = args.join(' ').trim();
  if (!title) {
    console.error('Usage: npm run start:product -- pursue <objective>');
    process.exitCode = 2;
  } else {
    const result = await naia.pursue({ title });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} else if (command === 'resume') {
  const [objectiveId] = args;
  if (!objectiveId) {
    console.error('Usage: npm run start:product -- resume <objectiveId>');
    process.exitCode = 2;
  } else {
    const result = await naia.resume(objectiveId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} else if (command === 'show') {
  const [objectiveId] = args;
  if (!objectiveId) {
    console.error('Usage: npm run start:product -- show <objectiveId>');
    process.exitCode = 2;
  } else {
    const snapshot = await naia.get(objectiveId);
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  }
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 2;
}

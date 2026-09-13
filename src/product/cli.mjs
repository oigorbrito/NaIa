#!/usr/bin/env node
import { createFilePorts } from './file-ports.mjs';
import { createNaiaService } from './service.mjs';
import { createProductShell } from './shell.mjs';

const [command = 'pursue', ...args] = process.argv.slice(2);
const ports = createFilePorts({ rootDir: process.env.NAIA_DATA_DIR || '.naia' });
const naia = createNaiaService(ports);
const shell = createProductShell(naia);

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  print(await shell.execute(command, args));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}

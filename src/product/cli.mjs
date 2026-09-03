#!/usr/bin/env node
import { createInMemoryPorts } from './ports.mjs';
import { createNaiaService } from './service.mjs';

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('Usage: node src/product/cli.mjs <objective>');
  process.exitCode = 2;
} else {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const result = await naia.pursue({ title });
  const evidence = await ports.evidence.list();
  process.stdout.write(`${JSON.stringify({ result, evidence }, null, 2)}\n`);
}

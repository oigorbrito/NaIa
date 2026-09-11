#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { evaluateMvpReadiness } from './readiness-evaluator.mjs';

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error('Usage: node src/product/readiness-evaluator-cli.mjs <input.json>');
  process.exitCode = 2;
} else {
  try {
    const raw = await readFile(inputPath, 'utf8');
    const input = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const result = evaluateMvpReadiness(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.mvpCoreReady !== 'PASS') process.exitCode = 2;
  } catch (error) {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 1;
  }
}

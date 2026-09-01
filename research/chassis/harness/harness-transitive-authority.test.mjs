import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FORMAL_HARNESS_FILES } from './harness-provenance.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FORMAL_HARNESS_SET = new Set(FORMAL_HARNESS_FILES);

const COMMON_ADAPTER_EXECUTION_GRAPH = Object.freeze([
  'research/chassis/adapters/temporal-ts/package.json',
  'research/chassis/adapters/temporal-ts/package-lock.json',
  'research/chassis/adapters/temporal-ts/adapter.mjs',
  'research/chassis/adapters/temporal-ts/workflows.mjs',
  'research/chassis/adapters/temporal-ts/activities.mjs',
  'research/chassis/adapters/dbos-ts/package.json',
  'research/chassis/adapters/dbos-ts/package-lock.json',
  'research/chassis/adapters/dbos-ts/adapter.mjs',
  'research/chassis/adapters/dbos-ts/workflows.mjs',
  'research/chassis/adapters/restate-ts/package.json',
  'research/chassis/adapters/restate-ts/package-lock.json',
  'research/chassis/adapters/restate-ts/adapter.mjs',
  'research/chassis/adapters/restate-ts/workflow.mjs',
  'research/chassis/adapters/triggerdev/package.json',
  'research/chassis/adapters/triggerdev/adapter.mjs',
  'research/chassis/adapters/triggerdev/trigger.config.mjs',
  'research/chassis/adapters/triggerdev/trigger/naia-objective.mjs'
]);

function repositoryRelative(file) {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join('/');
}

function importedRelativeSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g,
    /import\(\s*['"](\.[^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function resolveAuthorityImport(importer, specifier) {
  const importerAbsolute = path.join(REPOSITORY_ROOT, importer);
  const resolved = path.resolve(path.dirname(importerAbsolute), specifier);
  const candidates = path.extname(resolved)
    ? [resolved]
    : [`${resolved}.mjs`, `${resolved}.json`, path.join(resolved, 'index.mjs')];
  return candidates.map(repositoryRelative).find((candidate) =>
    candidate.startsWith('research/chassis/harness/') || candidate.startsWith('research/chassis/adapters/'));
}

test('formal harness hash covers the common-runner adapter execution graph for every candidate', () => {
  for (const file of COMMON_ADAPTER_EXECUTION_GRAPH) {
    assert.ok(FORMAL_HARNESS_FILES.includes(file), `missing transitive formal authority: ${file}`);
  }
});

test('formal harness identity is closed over relative production imports of hashed authorities', async () => {
  const missing = [];
  for (const importer of FORMAL_HARNESS_FILES.filter((file) => file.endsWith('.mjs'))) {
    const source = await readFile(path.join(REPOSITORY_ROOT, importer), 'utf8');
    for (const specifier of importedRelativeSpecifiers(source)) {
      const imported = resolveAuthorityImport(importer, specifier);
      if (imported && !FORMAL_HARNESS_SET.has(imported)) missing.push(`${importer} -> ${imported}`);
    }
  }
  assert.deepEqual(missing, [], `formal harness provenance misses imported authorities:\n${missing.join('\n')}`);
});

test('Restate formal lifecycle itself is part of formal harness identity', () => {
  assert.ok(FORMAL_HARNESS_FILES.includes('research/chassis/harness/formal-restate-lifecycle.mjs'));
});

test('formal harness file authority list contains no duplicate paths', () => {
  assert.equal(new Set(FORMAL_HARNESS_FILES).size, FORMAL_HARNESS_FILES.length);
});

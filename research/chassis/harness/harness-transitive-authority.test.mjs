import assert from 'node:assert/strict';
import test from 'node:test';
import { FORMAL_HARNESS_FILES } from './harness-provenance.mjs';

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

test('formal harness hash covers the common-runner adapter execution graph for every candidate', () => {
  for (const file of COMMON_ADAPTER_EXECUTION_GRAPH) {
    assert.ok(FORMAL_HARNESS_FILES.includes(file), `missing transitive formal authority: ${file}`);
  }
});

test('Restate formal lifecycle itself is part of formal harness identity', () => {
  assert.ok(FORMAL_HARNESS_FILES.includes('research/chassis/harness/formal-restate-lifecycle.mjs'));
});

test('formal harness file authority list contains no duplicate paths', () => {
  assert.equal(new Set(FORMAL_HARNESS_FILES).size, FORMAL_HARNESS_FILES.length);
});

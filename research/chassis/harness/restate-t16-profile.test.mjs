import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterRoot = path.resolve(here, '..', 'adapters', 'restate-ts');

async function source(name) {
  return readFile(path.join(adapterRoot, name), 'utf8');
}

test('Restate T16 driver uses explicit native deployment migration after a durable checkpoint', async () => {
  const driver = await source('t16-driver.mjs');
  assert.match(driver, /POST', '\/deployments'/);
  assert.match(driver, /\/pause`/);
  assert.match(driver, /\/resume\?deployment=latest`/);
  assert.match(driver, /durable-checkpoint-under-A/);
  assert.match(driver, /deploymentA === deploymentB/);
  assert.match(driver, /ROUTED_TO_COMPATIBLE/);
  assert.match(driver, /semanticMutation: \{ dimension: 'deploymentId'/);
});

test('Restate T16 variants preserve the same journal command and canonical meaning', async () => {
  const [a, b] = await Promise.all([source('t16-workflow-a.mjs'), source('t16-workflow-b.mjs')]);
  for (const variant of [a, b]) {
    assert.match(variant, /name: 'NaIaT16'/);
    assert.match(variant, /ctx\.run\('semantic-checkpoint'/);
    assert.match(variant, /naia-t16-canonical/);
    assert.match(variant, /ctx\.sleep/);
  }
  assert.match(a, /completedByVariant: 'A'/);
  assert.match(b, /completedByVariant: 'B'/);
});

test('Restate T16 service process exposes distinct A/B selectable deployment endpoints', async () => {
  const service = await source('t16-service-process.mjs');
  assert.match(service, /NAIA_T16_RESTATE_VARIANT/);
  assert.match(service, /NAIA_T16_RESTATE_PORT/);
  assert.match(service, /variant === 'A' \? t16WorkflowA : t16WorkflowB/);
  assert.match(service, /t16_service_ready/);
});

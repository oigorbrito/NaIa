import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runUntilKillpoint } from './crash-controller.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'fake-adapter.mjs');

test('kills process after the requested semantic event is observed', async () => {
  const result = await runUntilKillpoint({
    command: process.execPath,
    args: [fixture, 'emit-target'],
    killOnEvent: 'external_request_applied_or_ambiguous',
    timeoutMs: 2000
  });

  assert.equal(result.killIssued, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(
    result.events.some((entry) => entry.event === 'external_request_applied_or_ambiguous'),
    true
  );
});

test('fails closed by timing out when the requested event never appears', async () => {
  const result = await runUntilKillpoint({
    command: process.execPath,
    args: [fixture, 'omit-target'],
    killOnEvent: 'external_request_applied_or_ambiguous',
    timeoutMs: 150
  });

  assert.equal(result.killIssued, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(
    result.events.some((entry) => entry.event === 'external_request_applied_or_ambiguous'),
    false
  );
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const temporalRoot = path.resolve(here, '..', 'adapters', 'temporal-ts');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('Temporal T16 profiles preserve workflow/signal identity while mutating the durable timer command', async () => {
  const [profileA, profileB] = await Promise.all([
    readFile(path.join(temporalRoot, 't16-workflow-a.mjs'), 'utf8'),
    readFile(path.join(temporalRoot, 't16-workflow-b.mjs'), 'utf8')
  ]);

  for (const source of [profileA, profileB]) {
    assert.match(source, /export async function t16VersionedWorkflow\(input\)/);
    assert.match(source, /defineSignal\('naia-t16-release'\)/);
    assert.match(source, /semanticProfile: 'temporal-t16-profile-[AB]'/);
  }

  assert.match(profileA, /await sleep\('1ms'\)/);
  assert.doesNotMatch(profileB, /\bsleep\s*\(/);
  assert.match(profileB, /Deliberately omits profile A's durable timer command/);
  assert.notEqual(sha256(profileA), sha256(profileB));
});

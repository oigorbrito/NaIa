import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildExecutionPlan } from './experiment-executor.mjs';
import { appendRecordToLedger } from './experiment-ledger-validator.mjs';
import { readyFormalRecord, verifiedCleanupSupport } from './formal-test-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');
const REVISION = '1'.repeat(40);
const HARNESS = 'a'.repeat(64);

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

function supportEntry(candidate, supportRevision) {
  return verifiedCleanupSupport([candidate], supportRevision)[candidate];
}

function recordForSpec(spec, runtime = 'node v22.16.0', workerPid = 8101) {
  return readyFormalRecord({
    candidate: spec.candidate,
    mutantId: spec.mutantId,
    repetition: spec.repetition,
    repositoryRevision: REVISION,
    harnessSha256: HARNESS,
    runtime,
    workerPid,
    setupOverrides: {
      record: {
        experimentId: spec.experimentId,
        randomSeed: spec.randomSeed
      }
    },
    parameterOverrides: { randomSeed: spec.randomSeed }
  });
}

test('formal append accepts different candidate profiles only when the common runtime environment stays frozen', async () => {
  const [protocol, faultSuite] = await Promise.all([json('experiment-protocol.v1.json'), json('fault-suite.v1.json')]);
  const plan = buildExecutionPlan(protocol, faultSuite);
  assert.equal(plan[0].candidate, 'Temporal TypeScript');
  assert.equal(plan[1].candidate, 'DBOS TypeScript');
  const cleanupSupport = {
    'Temporal TypeScript': supportEntry('Temporal TypeScript', '8'.repeat(40)),
    'DBOS TypeScript': supportEntry('DBOS TypeScript', '9'.repeat(40))
  };

  const first = appendRecordToLedger([], recordForSpec(plan[0], 'node v22.16.0', 8101), protocol, faultSuite, { cleanupSupport });
  const second = appendRecordToLedger(first.records, recordForSpec(plan[1], 'node v22.16.0', 8201), protocol, faultSuite, { cleanupSupport });
  assert.equal(second.environmentConsistency.consistent, true, second.environmentConsistency.errors.join('\n'));
  assert.equal(second.environmentConsistency.commonEnvironmentSha256s.length, 1);
  assert.equal(second.environmentConsistency.candidateProfiles['Temporal TypeScript'].length, 1);
  assert.equal(second.environmentConsistency.candidateProfiles['DBOS TypeScript'].length, 1);
});

test('formal append rejects the next preregistered candidate when Node runtime would cross the frozen common environment identity', async () => {
  const [protocol, faultSuite] = await Promise.all([json('experiment-protocol.v1.json'), json('fault-suite.v1.json')]);
  const plan = buildExecutionPlan(protocol, faultSuite);
  const cleanupSupport = {
    'Temporal TypeScript': supportEntry('Temporal TypeScript', '8'.repeat(40)),
    'DBOS TypeScript': supportEntry('DBOS TypeScript', '9'.repeat(40))
  };
  const first = appendRecordToLedger([], recordForSpec(plan[0], 'node v22.16.0', 8101), protocol, faultSuite, { cleanupSupport });

  assert.throws(
    () => appendRecordToLedger(
      first.records,
      recordForSpec(plan[1], 'node v24.0.0', 8201),
      protocol,
      faultSuite,
      { cleanupSupport }
    ),
    /appended formal ledger would mix environment identities/
  );
});

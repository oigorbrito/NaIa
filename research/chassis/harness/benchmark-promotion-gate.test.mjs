import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessCandidatePromotion } from './benchmark-promotion-gate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');
const critical = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16'];

async function faultSuite() {
  return JSON.parse(await readFile(path.join(chassisRoot, 'fault-suite.v1.json'), 'utf8'));
}

function record(candidate, mutantId, repetition, verdict = 'PASS') {
  const pass = verdict === 'PASS';
  const fail = verdict === 'FAIL';
  return {
    schemaVersion: 1,
    experimentId: `${candidate}-${mutantId}-${repetition}`,
    candidate,
    mutantId,
    repetition,
    randomSeed: repetition,
    setup: {
      status: 'READY',
      candidateVersion: 'fixture',
      candidateSourceRef: 'fixture',
      adapterSha256: 'a'.repeat(64),
      harnessSha256: 'b'.repeat(64),
      dependencyIdentity: null,
      environment: { os: 'fixture-os', arch: 'fixture-arch', runtime: 'node v22.0.0' },
      parameters: {},
      cleanupVerifiedBeforeRun: true
    },
    run: {
      startedAt: '2026-08-31T00:00:00.000Z',
      finishedAt: '2026-08-31T00:00:01.000Z',
      blocked: false,
      blocker: null,
      workload: {},
      fault: {
        intended: mutantId,
        injected: true,
        targetKind: 'worker-process',
        targetIdentity: 1,
        signal: mutantId === 'T7' ? 'SIGKILL' : null,
        durableAuthorityAlive: pass ? true : null
      },
      rawObservations: mutantId === 'T16' && pass ? { semanticMutation: { dimension: 'config', before: 'a', after: 'b' } } : {},
      acceptanceChecks: pass ? { invariant: true } : fail ? { invariant: false } : { invariant: true }
    },
    cleanup: {
      status: 'PASS',
      workerCleanup: true,
      durableStateCleanup: true,
      oracleCleanup: true,
      temporaryResourcesCleanup: true
    },
    artifacts: [{ name: 'fixture.json', path: null, sha256: 'c'.repeat(64) }],
    verdict,
    blocker: null
  };
}

function completeCandidate(candidate, verdictByMutant = {}) {
  const records = [];
  for (const mutantId of critical) {
    for (let repetition = 1; repetition <= 100; repetition += 1) {
      records.push(record(candidate, mutantId, repetition, verdictByMutant[mutantId] ?? 'PASS'));
    }
  }
  return records;
}

test('complete all-PASS critical evidence is promotion-qualified', async () => {
  const result = assessCandidatePromotion(completeCandidate('Temporal TypeScript'), await faultSuite());
  assert.equal(result.comparable, true, result.errors.join('\n'));
  assert.equal(result.qualified, true, result.errors.join('\n'));
  assert.deepEqual(result.exceptions, []);
});

test('critical FAIL evidence is comparable but not promotion-qualified without explicit policy', async () => {
  const result = assessCandidatePromotion(completeCandidate('Temporal TypeScript', { T7: 'FAIL' }), await faultSuite());
  assert.equal(result.comparable, true);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /T7: critical FAIL requires explicit enforced acceptance\/exclusion policy/);
});

test('critical FAIL can pass promotion only with explicit enforced constraint and justification', async () => {
  const suite = await faultSuite();
  const records = completeCandidate('Temporal TypeScript', { T7: 'FAIL' });
  const acceptedFailures = {
    'Temporal TypeScript': {
      T7: {
        enforced: true,
        constraint: 'forbid direct non-reconciled category-C external effects',
        justification: 'configuration excludes the demonstrated unsafe path'
      }
    }
  };
  const result = assessCandidatePromotion(records, suite, { acceptedFailures });
  assert.equal(result.comparable, true, result.errors.join('\n'));
  assert.equal(result.qualified, true, result.errors.join('\n'));
  assert.ok(result.exceptions.some((entry) => entry.mutantId === 'T7' && entry.verdict === 'FAIL'));
});

test('policy object without enforced=true cannot waive a critical FAIL', async () => {
  const suite = await faultSuite();
  const records = completeCandidate('Temporal TypeScript', { T7: 'FAIL' });
  const acceptedFailures = {
    'Temporal TypeScript': {
      T7: { enforced: false, constraint: 'documentation only', justification: 'not mechanically enforced' }
    }
  };
  const result = assessCandidatePromotion(records, suite, { acceptedFailures });
  assert.equal(result.qualified, false);
});

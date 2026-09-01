import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessBenchmarkExecutionReadiness, assertBenchmarkExecutionReady } from './benchmark-execution-readiness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

function completeCleanupSupport(candidates) {
  return Object.fromEntries(candidates.map((candidate, index) => [candidate.candidate, {
    preRunCleanup: true,
    postRunCleanup: true,
    status: 'RUNTIME_VERIFIED',
    verificationEvidence: {
      executionRef: `test-fixture:${candidate.candidate}`,
      experimentId: `${candidate.candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-t5-001`,
      mutantId: 'T5',
      repetition: 1,
      recordSha256: String(index + 1).padStart(64, 'a').slice(-64),
      validatorSha256: String(index + 1).padStart(64, 'b').slice(-64),
      verifiedAt: '2026-09-01T00:00:00.000Z'
    }
  }]));
}

test('current gate records executor gaps and keeps formal cleanup unavailable until concrete cleanup hooks have runtime evidence', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  const result = assessBenchmarkExecutionReadiness(protocol, plan);

  assert.equal(result.ready, false);
  assert.equal(result.status, 'BENCHMARK_EXECUTION_NOT_READY');
  assert.deepEqual(result.unsupportedMutants, []);
  assert.deepEqual(result.unsupportedCandidateMutants, [
    {
      candidate: 'Trigger.dev', mutantId: 'T5', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: ['Temporal TypeScript', 'DBOS TypeScript', 'Restate']
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T7', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: null
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T11', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: ['Temporal TypeScript', 'DBOS TypeScript', 'Restate']
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T12', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: ['Temporal TypeScript', 'DBOS TypeScript', 'Restate']
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T16', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: ['Temporal TypeScript', 'DBOS TypeScript', 'Restate']
    }
  ]);
  assert.deepEqual(result.unsupportedCleanupCandidates, plan.candidates.map((candidate) => ({
    candidate: candidate.candidate,
    mode: candidate.mode,
    missingPhases: ['preRunCleanup', 'postRunCleanup'],
    status: candidate.candidate === 'Temporal TypeScript' || candidate.candidate === 'DBOS TypeScript'
      ? 'IMPLEMENTED_NOT_RUNTIME_VERIFIED'
      : 'NOT_IMPLEMENTED',
    evidenceBacked: false
  })));
});

test('readiness opens only when every critical mutant and cleanup phase has evidence-backed support for every candidate', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  const completeSupport = Object.fromEntries(protocol.criticalMutants.map((mutantId) => [mutantId, {
    modes: ['local-process', 'managed-controller'],
    candidates: null,
    fault: `fixture-${mutantId}`
  }]));
  const cleanupSupport = completeCleanupSupport(plan.candidates);

  const result = assessBenchmarkExecutionReadiness(protocol, plan, completeSupport, cleanupSupport);
  assert.equal(result.ready, true);
  assert.equal(result.status, 'BENCHMARK_EXECUTION_READY');
  assert.deepEqual(result.unsupportedMutants, []);
  assert.deepEqual(result.unsupportedCandidateMutants, []);
  assert.deepEqual(result.unsupportedCleanupCandidates, []);
  assert.equal(assertBenchmarkExecutionReady(protocol, plan, completeSupport, cleanupSupport).ready, true);
});

test('boolean-only cleanup support without receipt evidence cannot open readiness', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = { criticalMutants: ['T5'], candidates: [{ candidate: 'Temporal TypeScript', mode: 'local-process' }] };
  const support = { T5: { modes: ['local-process'], candidates: null } };
  const cleanupSupport = {
    'Temporal TypeScript': { preRunCleanup: true, postRunCleanup: true, status: 'RUNTIME_VERIFIED', verificationEvidence: null }
  };
  const result = assessBenchmarkExecutionReadiness(protocol, plan, support, cleanupSupport);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedCleanupCandidates[0].evidenceBacked, false);
  assert.deepEqual(result.unsupportedCleanupCandidates[0].missingPhases, []);
});

test('candidate allowlist is enforced independently of execution mode', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = {
    criticalMutants: ['T5'],
    candidates: [
      { candidate: 'Temporal TypeScript', mode: 'local-process' },
      { candidate: 'DBOS TypeScript', mode: 'local-process' }
    ]
  };
  const support = { T5: { modes: ['local-process'], candidates: ['Temporal TypeScript'] } };
  const cleanupSupport = completeCleanupSupport(plan.candidates);
  const result = assessBenchmarkExecutionReadiness(protocol, plan, support, cleanupSupport);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedCandidateMutants.length, 1);
  assert.equal(result.unsupportedCandidateMutants[0].candidate, 'DBOS TypeScript');
  assert.deepEqual(result.unsupportedCleanupCandidates, []);
});

test('assertBenchmarkExecutionReady fails closed with explicit remaining candidate and cleanup gaps', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  assert.throws(
    () => assertBenchmarkExecutionReady(protocol, plan),
    /Trigger\.dev\/T5: formal executor not implemented for candidate\/mode/
  );
  assert.throws(
    () => assertBenchmarkExecutionReady(protocol, plan),
    /Temporal TypeScript: formal cleanup not runtime-verified with evidence/
  );
});

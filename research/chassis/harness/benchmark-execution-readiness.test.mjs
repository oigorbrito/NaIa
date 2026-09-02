import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessBenchmarkExecutionReadiness, assertBenchmarkExecutionReady } from './benchmark-execution-readiness.mjs';
import { currentLifecycleQualificationSha256 } from './formal-lifecycle-qualification-provenance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');
const REPOSITORY_REVISION = '1'.repeat(40);

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

function completeCleanupSupport(candidates) {
  return Object.fromEntries(candidates.map((candidate, index) => [candidate.candidate, {
    preRunCleanup: true,
    postRunCleanup: true,
    status: 'RUNTIME_VERIFIED',
    verificationEvidence: {
      executionRef: `github-actions:run=fixture;job=${candidate.candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase()};sha=${REPOSITORY_REVISION}`,
      repositoryRevision: REPOSITORY_REVISION,
      experimentId: `${candidate.candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-t5-001`,
      mutantId: 'T5',
      repetition: 1,
      recordSha256: String(index + 1).padStart(64, 'a').slice(-64),
      validatorSha256: String(index + 1).padStart(64, 'b').slice(-64),
      harnessSha256: String(index + 1).padStart(64, 'c').slice(-64),
      lifecycleQualificationSha256: currentLifecycleQualificationSha256(candidate.candidate),
      runtimeIdentitySha256: String(index + 1).padStart(64, 'd').slice(-64),
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
    status: ['Temporal TypeScript', 'DBOS TypeScript', 'Restate'].includes(candidate.candidate)
      ? 'IMPLEMENTED_NOT_RUNTIME_VERIFIED'
      : 'NOT_IMPLEMENTED',
    evidenceBacked: false
  })));
});

test('readiness algorithm opens when every declared candidate has executor support and current evidence-backed cleanup support', () => {
  const protocol = { criticalMutants: ['T5', 'T7'] };
  const plan = {
    criticalMutants: ['T5', 'T7'],
    candidates: [
      { candidate: 'Temporal TypeScript', mode: 'local-process' },
      { candidate: 'DBOS TypeScript', mode: 'local-process' },
      { candidate: 'Restate', mode: 'local-process' }
    ]
  };
  const completeSupport = {
    T5: { modes: ['local-process'], candidates: null, fault: 'fixture-T5' },
    T7: { modes: ['local-process'], candidates: null, fault: 'fixture-T7' }
  };
  const cleanupSupport = completeCleanupSupport(plan.candidates);

  const result = assessBenchmarkExecutionReadiness(protocol, plan, completeSupport, cleanupSupport);
  assert.equal(result.ready, true);
  assert.equal(result.status, 'BENCHMARK_EXECUTION_READY');
  assert.deepEqual(result.unsupportedMutants, []);
  assert.deepEqual(result.unsupportedCandidateMutants, []);
  assert.deepEqual(result.unsupportedCleanupCandidates, []);
  assert.equal(assertBenchmarkExecutionReady(protocol, plan, completeSupport, cleanupSupport).ready, true);
});

test('cleanup support without harness hash evidence cannot open readiness', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = { criticalMutants: ['T5'], candidates: [{ candidate: 'Temporal TypeScript', mode: 'local-process' }] };
  const support = { T5: { modes: ['local-process'], candidates: null } };
  const cleanupSupport = completeCleanupSupport(plan.candidates);
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.harnessSha256;
  const result = assessBenchmarkExecutionReadiness(protocol, plan, support, cleanupSupport);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedCleanupCandidates[0].evidenceBacked, false);
});

test('cleanup support without current lifecycle qualification hash cannot open readiness', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = { criticalMutants: ['T5'], candidates: [{ candidate: 'Restate', mode: 'local-process' }] };
  const support = { T5: { modes: ['local-process'], candidates: null } };
  const cleanupSupport = completeCleanupSupport(plan.candidates);
  cleanupSupport.Restate.verificationEvidence.lifecycleQualificationSha256 = '0'.repeat(64);
  const result = assessBenchmarkExecutionReadiness(protocol, plan, support, cleanupSupport);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedCleanupCandidates[0].evidenceBacked, false);
});

test('cleanup support without native runtime identity hash cannot open readiness', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = { criticalMutants: ['T5'], candidates: [{ candidate: 'Temporal TypeScript', mode: 'local-process' }] };
  const support = { T5: { modes: ['local-process'], candidates: null } };
  const cleanupSupport = completeCleanupSupport(plan.candidates);
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.runtimeIdentitySha256;
  const result = assessBenchmarkExecutionReadiness(protocol, plan, support, cleanupSupport);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedCleanupCandidates[0].evidenceBacked, false);
});

test('cleanup support without repository revision cannot open readiness', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = { criticalMutants: ['T5'], candidates: [{ candidate: 'Temporal TypeScript', mode: 'local-process' }] };
  const support = { T5: { modes: ['local-process'], candidates: null } };
  const cleanupSupport = completeCleanupSupport(plan.candidates);
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.repositoryRevision;
  const result = assessBenchmarkExecutionReadiness(protocol, plan, support, cleanupSupport);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedCleanupCandidates[0].evidenceBacked, false);
});

test('cleanup support whose execution ref points to another Git revision cannot open readiness', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = { criticalMutants: ['T5'], candidates: [{ candidate: 'Restate', mode: 'local-process' }] };
  const support = { T5: { modes: ['local-process'], candidates: null } };
  const cleanupSupport = completeCleanupSupport(plan.candidates);
  cleanupSupport.Restate.verificationEvidence.executionRef = `github-actions:run=fixture;job=restate;sha=${'2'.repeat(40)}`;
  const result = assessBenchmarkExecutionReadiness(protocol, plan, support, cleanupSupport);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedCleanupCandidates[0].evidenceBacked, false);
});

test('boolean-only cleanup support without receipt evidence cannot open readiness', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = { criticalMutants: ['T5'], candidates: [{ candidate: 'Restate', mode: 'local-process' }] };
  const support = { T5: { modes: ['local-process'], candidates: null } };
  const cleanupSupport = {
    Restate: { preRunCleanup: true, postRunCleanup: true, status: 'RUNTIME_VERIFIED', verificationEvidence: null }
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
    /Restate: formal cleanup not runtime-verified with evidence/
  );
});

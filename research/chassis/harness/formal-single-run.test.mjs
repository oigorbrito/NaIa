import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FORMAL_LIFECYCLE_QUALIFICATION_PROFILE } from './formal-lifecycle-qualification-provenance.mjs';
import { runFormalSingle } from './formal-single-run.mjs';
import { FORMAL_HARNESS_FILES } from './harness-provenance.mjs';

const candidates = ['Temporal TypeScript', 'DBOS TypeScript', 'Restate', 'Trigger.dev'];
const criticalMutants = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16'];
const repositoryRevisionPolicy = 'single-verified-git-revision-per-formal-ledger';
const environmentIdentityPolicy = 'single-common-runtime-and-candidate-profile-per-formal-ledger';
const a001Constraint = 'The T5/r1 lifecycle qualification support may originate from an earlier verified revision only while its candidate lifecycle-qualification hash remains current; every record admitted to one formal benchmark ledger must otherwise share one verified Git repository revision.';
const a002Constraint = 'Every READY record in one formal ledger must share one canonical common execution environment identity for OS, architecture, Node runtime and recorded package-manager identity; within each candidate, every READY record must also share one canonical candidate profile derived from candidate/source identity, adapter SHA-256, manifest and exact installed dependency versions, declared mode/authority boundary, lifecycle-qualification SHA-256 and stable observed native runtime identity. Dynamic workspace paths, ports, task queues, process IDs, container IDs and database URLs are excluded from identity.';
const requiredRecordFields = [
  'experimentId', 'candidate', 'mutantId', 'repetition',
  'setup.candidateVersion', 'setup.candidateSourceRef', 'setup.adapterSha256', 'setup.harnessSha256',
  'setup.dependencyIdentity', 'setup.environment', 'setup.parameters', 'setup.preRunCleanupReceipt',
  'run.startedAt', 'run.finishedAt', 'run.fault', 'run.workload', 'run.rawObservations', 'run.acceptanceChecks',
  'cleanup', 'artifacts', 'verdict'
];

async function writeJson(root, relativePath, value) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertLifecycleQualification(record, candidate) {
  const value = record.setup.environment.formalLifecycleQualification;
  assert.equal(value.profile, FORMAL_LIFECYCLE_QUALIFICATION_PROFILE);
  assert.equal(value.candidate, candidate);
  assert.match(value.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(value.fileCount) && value.fileCount > 0);
}

async function syntheticBlockedRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'naia-formal-single-'));

  const protocol = {
    schemaVersion: 1,
    status: 'SPECIFIED_NOT_EXECUTED',
    methodology: {
      preExecutionAmendments: [
        {
          id: 'A001', date: '2026-09-01', status: 'FROZEN_BEFORE_FORMAL_EXECUTION', policy: repositoryRevisionPolicy,
          reason: 'synthetic fixture mirrors the frozen repository revision comparability rule', outcomeDriven: false,
          changesSemanticVerdicts: false, changesRepetitionThreshold: false,
          lifecycleQualificationMayPrecedeBenchmarkRevision: true, constraint: a001Constraint
        },
        {
          id: 'A002', date: '2026-09-01', status: 'FROZEN_BEFORE_FORMAL_EXECUTION', policy: environmentIdentityPolicy,
          reason: 'synthetic fixture mirrors the frozen formal environment comparability rule', outcomeDriven: false,
          changesSemanticVerdicts: false, changesRepetitionThreshold: false, constraint: a002Constraint
        }
      ]
    },
    decisionState: { benchmarkToBeat: 'NOT_SELECTED', chassisWinner: 'NOT_SELECTED' },
    candidates,
    criticalMutants,
    repetitionPolicy: {
      minimumPerCriticalMutant: 100,
      seedPolicy: {
        requiredWhenRandomized: true,
        candidateOrdinals: { 'Temporal TypeScript': 1, 'DBOS TypeScript': 2, Restate: 3, 'Trigger.dev': 4 },
        mutantOrdinals: { T5: 5, T7: 7, T8: 8, T11: 11, T12: 12, T16: 16 }
      }
    },
    executionOrder: {
      policy: 'round-robin-by-repetition', sequence: 'synthetic test sequence',
      repositoryRevisionPolicy, environmentIdentityPolicy
    },
    requiredRecordFields
  };
  const faultSuite = {
    schemaVersion: 1,
    mutants: criticalMutants.map((id) => ({ id, critical: true, minRepetitions: 100 })),
    benchmarkEligibility: { forbidBlockedOrInconclusive: criticalMutants }
  };
  const capabilities = {
    schemaVersion: 1,
    candidates: [
      {
        candidate: 'Temporal TypeScript', version: '1.23.0', source_ref: 'temporalio/sdk-typescript v1.23.0',
        execution_package: { '@temporalio/worker': '1.23.0' }, package_manifest: 'research/chassis/adapters/temporal-ts/package.json',
        adapter: 'research/chassis/adapters/temporal-ts/adapter.mjs', mode: 'local-process', required_env: [],
        worker_authority_boundary: 'synthetic Temporal worker boundary', blocker: 'B001'
      },
      {
        candidate: 'DBOS TypeScript', version: '4.27.6', source_ref: 'dbos-inc/dbos-transact-ts v4.27',
        execution_package: { '@dbos-inc/dbos-sdk': '4.27.6' }, package_manifest: 'research/chassis/adapters/dbos-ts/package.json',
        adapter: 'research/chassis/adapters/dbos-ts/adapter.mjs', mode: 'local-process', required_env: ['DBOS_SYSTEM_DATABASE_URL'],
        worker_authority_boundary: 'synthetic DBOS executor boundary', blocker: 'B001'
      },
      {
        candidate: 'Restate', version: 'v1.7.8', source_ref: 'restatedev/restate v1.7.8',
        execution_package: { '@restatedev/restate-sdk': '1.16.9' }, package_manifest: 'research/chassis/adapters/restate-ts/package.json',
        adapter: 'research/chassis/adapters/restate-ts/adapter.mjs', mode: 'local-process', required_env: [],
        worker_authority_boundary: 'synthetic Restate service process boundary', blocker: 'B001'
      },
      {
        candidate: 'Trigger.dev', version: '4.5.15', source_ref: 'triggerdotdev/trigger.dev v4.5.15',
        execution_package: { '@trigger.dev/sdk': '4.5.15' }, package_manifest: 'research/chassis/adapters/triggerdev/package.json',
        adapter: 'research/chassis/adapters/triggerdev/adapter.mjs', mode: 'managed-controller', required_env: ['TRIGGER_SECRET_KEY'],
        worker_authority_boundary: 'synthetic Trigger worker boundary', blocker: 'B001+B003'
      }
    ]
  };

  await writeJson(root, 'research/chassis/experiment-protocol.v1.json', protocol);
  await writeJson(root, 'research/chassis/fault-suite.v1.json', faultSuite);
  await writeJson(root, 'research/chassis/adapter-capabilities.v1.json', capabilities);
  await writeJson(root, 'research/chassis/experiment-record.schema.v1.json', { schemaVersion: 1, synthetic: true });

  for (const relativePath of FORMAL_HARNESS_FILES) {
    if (['research/chassis/experiment-protocol.v1.json', 'research/chassis/fault-suite.v1.json', 'research/chassis/adapter-capabilities.v1.json', 'research/chassis/experiment-record.schema.v1.json'].includes(relativePath)) continue;
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `// synthetic provenance fixture: ${relativePath}\n`);
  }

  await writeJson(root, 'research/chassis/adapters/temporal-ts/package.json', {
    name: 'synthetic-temporal-adapter', private: true, type: 'module', dependencies: { '@temporalio/worker': '1.23.0' }
  });
  const temporalAdapter = path.join(root, 'research/chassis/adapters/temporal-ts/adapter.mjs');
  await mkdir(path.dirname(temporalAdapter), { recursive: true });
  await writeFile(temporalAdapter, '// synthetic Temporal adapter; runtime dependency intentionally absent\n');

  await writeJson(root, 'research/chassis/adapters/dbos-ts/package.json', {
    name: 'synthetic-dbos-adapter', private: true, type: 'module', dependencies: { '@dbos-inc/dbos-sdk': '4.27.6' }
  });
  const dbosAdapter = path.join(root, 'research/chassis/adapters/dbos-ts/adapter.mjs');
  await mkdir(path.dirname(dbosAdapter), { recursive: true });
  await writeFile(dbosAdapter, '// synthetic DBOS adapter; runtime dependency intentionally absent\n');

  return root;
}

test('declared Temporal T7 single-run records missing SDK as valid BLOCKED evidence with formal provenance and without executing fault', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const result = await runFormalSingle({ repositoryRoot, candidateName: 'Temporal TypeScript', mutantId: 'T7', repetition: 1, env: {}, timeoutMs: 1000 });
  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.experimentId, 'temporal-typescript-t7-001');
  assert.equal(result.record.randomSeed, 1070001);
  assert.equal(result.record.verdict, 'BLOCKED');
  assert.equal(result.record.setup.status, 'BLOCKED_SETUP');
  assert.match(result.record.blocker, /DEPENDENCY_NOT_INSTALLED/);
  assert.match(result.record.setup.harnessSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.record.setup.parameters.harnessProvenanceMode, 'FORMAL_BUNDLE');
  assertLifecycleQualification(result.record, 'Temporal TypeScript');
  assert.match(result.record.setup.environment.formalPromotionPolicy.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.record.run.fault.injected, false);
  assert.equal(result.record.cleanup.status, 'NOT_APPLICABLE');
});

test('declared Temporal T5 single-run may reach setup and remain BLOCKED when SDK is missing while preserving candidate qualification provenance', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const result = await runFormalSingle({ repositoryRoot, candidateName: 'Temporal TypeScript', mutantId: 'T5', repetition: 1, env: {}, timeoutMs: 1000 });
  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.experimentId, 'temporal-typescript-t5-001');
  assert.equal(result.record.randomSeed, 1050001);
  assert.equal(result.record.verdict, 'BLOCKED');
  assertLifecycleQualification(result.record, 'Temporal TypeScript');
  assert.equal(result.record.run.fault.injected, false);
});

test('declared Temporal T16 single-run records missing SDK as valid BLOCKED evidence before the driver executes', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const result = await runFormalSingle({ repositoryRoot, candidateName: 'Temporal TypeScript', mutantId: 'T16', repetition: 1, env: {}, timeoutMs: 1000 });
  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.experimentId, 'temporal-typescript-t16-001');
  assert.equal(result.record.randomSeed, 1160001);
  assert.equal(result.record.verdict, 'BLOCKED');
  assert.equal(result.record.setup.status, 'BLOCKED_SETUP');
  assert.match(result.record.blocker, /DEPENDENCY_NOT_INSTALLED/);
  assertLifecycleQualification(result.record, 'Temporal TypeScript');
  assert.equal(result.record.run.fault.intended, 'T16');
  assert.equal(result.record.run.fault.injected, false);
  assert.deepEqual(result.record.run.rawObservations, { setupBlocked: true });
  assert.equal(result.record.cleanup.status, 'NOT_APPLICABLE');
});

test('declared DBOS T16 single-run records missing SDK/env as valid BLOCKED evidence before the driver executes with DBOS qualification provenance', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const result = await runFormalSingle({ repositoryRoot, candidateName: 'DBOS TypeScript', mutantId: 'T16', repetition: 1, env: {}, timeoutMs: 1000 });
  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.experimentId, 'dbos-typescript-t16-001');
  assert.equal(result.record.randomSeed, 2160001);
  assert.equal(result.record.verdict, 'BLOCKED');
  assert.equal(result.record.setup.status, 'BLOCKED_SETUP');
  assert.match(result.record.blocker, /(DEPENDENCY_NOT_INSTALLED|REQUIRED_ENV_MISSING)/);
  assert.match(result.record.setup.harnessSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.record.setup.parameters.harnessProvenanceMode, 'FORMAL_BUNDLE');
  assertLifecycleQualification(result.record, 'DBOS TypeScript');
  assert.equal(result.record.run.fault.intended, 'T16');
  assert.equal(result.record.run.fault.injected, false);
  assert.deepEqual(result.record.run.rawObservations, { setupBlocked: true });
  assert.equal(result.record.cleanup.status, 'NOT_APPLICABLE');
});

test('formal single-run rejects a critical mutant without a declared executor before record creation', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  await assert.rejects(
    runFormalSingle({ repositoryRoot, candidateName: 'Trigger.dev', mutantId: 'T11', repetition: 1, env: {} }),
    /FORMAL_EXECUTOR_NOT_DECLARED_FOR_CANDIDATE:Trigger\.dev\/T11/
  );
});

test('formal single-run rejects T15 because it is outside the declared formal executor set', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  await assert.rejects(
    runFormalSingle({ repositoryRoot, candidateName: 'Temporal TypeScript', mutantId: 'T15', repetition: 1, env: {} }),
    /FORMAL_EXECUTOR_NOT_DECLARED_FOR_CANDIDATE:Temporal TypeScript\/T15/
  );
});

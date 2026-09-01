import { candidateProfileRecordFields } from './formal-candidate-profile-binding.mjs';
import {
  currentLifecycleQualificationProvenance,
  currentLifecycleQualificationSha256
} from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';

export const TEST_REPOSITORY_REVISION = '1'.repeat(40);
export const TEST_HARNESS_SHA256 = 'a'.repeat(64);

export function candidateSlug(candidate) {
  return candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export function lifecycleQualificationRecord(candidate) {
  const value = currentLifecycleQualificationProvenance(candidate);
  return value ? {
    profile: value.profile,
    candidate: value.candidate,
    sha256: value.aggregateSha256,
    fileCount: value.fileCount
  } : null;
}

export function verifiedCleanupSupport(candidates = ['Temporal TypeScript'], revision = TEST_REPOSITORY_REVISION) {
  return Object.fromEntries(candidates.map((candidate, index) => [
    candidate,
    {
      preRunCleanup: true,
      postRunCleanup: true,
      status: 'RUNTIME_VERIFIED',
      verificationEvidence: {
        executionRef: `github-actions:run=fixture;job=${candidateSlug(candidate)};sha=${revision}`,
        repositoryRevision: revision,
        experimentId: `${candidateSlug(candidate)}-t5-001`,
        mutantId: 'T5',
        repetition: 1,
        recordSha256: String(index + 1).repeat(64).slice(0, 64),
        validatorSha256: String(index + 2).repeat(64).slice(0, 64),
        harnessSha256: String(index + 3).repeat(64).slice(0, 64),
        lifecycleQualificationSha256: currentLifecycleQualificationSha256(candidate),
        verifiedAt: '2026-09-01T00:00:00.000Z'
      }
    }
  ]));
}

function temporalReceipt(overrides = {}) {
  return {
    status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true,
    cliSha256: 'b'.repeat(64),
    versionOutput: 'Temporal CLI 1.8.1 Server 1.31.2',
    expectedProfile: {
      sdkVersion: '1.23.0', cliVersion: '1.8.1', serverVersion: '1.31.2', platform: 'linux', arch: 'x64'
    },
    observedPlatform: { platform: 'linux', arch: 'x64' },
    workspace: '/tmp/dynamic-temporal', address: '127.0.0.1:7233', serverPid: 4100,
    taskQueues: { NAIA_TEMPORAL_TASK_QUEUE: 'dynamic-queue' },
    ...overrides
  };
}

function dbosReceipt(overrides = {}) {
  return {
    status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true,
    dockerVersion: 'Docker version 28.0.0',
    postgresImage: 'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297',
    postgresImageIdentity: 'postgres@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 sha256:' + 'c'.repeat(64),
    observedPlatform: { platform: 'linux', arch: 'x64' },
    workspace: '/tmp/dynamic-dbos', containerId: 'dynamic-container',
    databaseUrlRedacted: 'postgresql://postgres:***@127.0.0.1:54321/naia_chassis',
    ...overrides
  };
}

export function formalPreRunReceipt(candidate, overrides = {}) {
  if (candidate === 'Temporal TypeScript') return temporalReceipt(overrides);
  if (candidate === 'DBOS TypeScript') return dbosReceipt(overrides);
  return {
    status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true,
    formalRuntimeIdentity: { candidate, profile: 'synthetic-future-formal-runtime' },
    ...overrides
  };
}

export function formalDependencyIdentity(candidate, { installed = true, installedVersionOverrides = {} } = {}) {
  const fields = candidateProfileRecordFields(candidate, { installed });
  return {
    manifestPath: `/fixture/${candidateSlug(candidate)}/package.json`,
    manifestSha256: fields.manifestSha256,
    packages: fields.packages.map((entry) => ({
      ...entry,
      installedVersion: Object.prototype.hasOwnProperty.call(installedVersionOverrides, entry.package)
        ? installedVersionOverrides[entry.package]
        : entry.installedVersion,
      installedPackageJson: `/fixture/node_modules/${entry.package}/package.json`
    }))
  };
}

export function readyFormalRecord({
  candidate = 'Temporal TypeScript',
  mutantId = 'T7',
  repetition = 1,
  verdict = 'PASS',
  repositoryRevision = TEST_REPOSITORY_REVISION,
  harnessSha256 = TEST_HARNESS_SHA256,
  runtime = 'node v22.16.0',
  os = 'linux 6.11.0',
  arch = 'x64',
  packageManager = null,
  workerPid = 7000 + repetition,
  receiptOverrides = {},
  setupOverrides = {},
  environmentOverrides = {},
  parameterOverrides = {},
  dependencyIdentityOverrides = null,
  runOverrides = {},
  cleanupOverrides = {}
} = {}) {
  const fields = candidateProfileRecordFields(candidate);
  const pass = verdict === 'PASS';
  const acceptanceChecks = verdict === 'FAIL' ? { invariant: false } : { invariant: true };
  const rawObservations = { workerProcessPids: [workerPid], workerA: { pid: workerPid } };
  if (mutantId === 'T16') rawObservations.semanticMutation = { dimension: 'config', before: 'a', after: 'b' };

  const base = {
    schemaVersion: 1,
    experimentId: `${candidateSlug(candidate)}-${mutantId.toLowerCase()}-${String(repetition).padStart(3, '0')}`,
    candidate,
    mutantId,
    repetition,
    randomSeed: repetition,
    setup: {
      status: 'READY',
      candidateVersion: fields.candidateVersion,
      candidateSourceRef: fields.candidateSourceRef,
      adapterSha256: fields.adapterSha256,
      harnessSha256,
      dependencyIdentity: formalDependencyIdentity(candidate),
      environment: {
        os, arch, runtime, packageManager,
        repositoryProvenance: {
          source: 'git', status: 'VERIFIED', revision: repositoryRevision,
          trackedWorktreeClean: true, reason: null
        },
        formalPromotionPolicy: formalPromotionPolicyProvenance(),
        formalLifecycleQualification: lifecycleQualificationRecord(candidate),
        formalRuntimeLifecycle: { candidate, status: 'RUNTIME_VERIFIED' }
      },
      parameters: {
        mode: fields.mode,
        workerAuthorityBoundary: fields.workerAuthorityBoundary
      },
      cleanupVerifiedBeforeRun: true,
      preRunCleanupReceipt: formalPreRunReceipt(candidate, receiptOverrides)
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T00:00:01.000Z',
      blocked: false, blocker: null, workload: {},
      fault: { intended: mutantId, injected: true, targetKind: 'worker-process', targetIdentity: workerPid, signal: mutantId === 'T7' ? 'SIGKILL' : null, durableAuthorityAlive: true },
      rawObservations,
      acceptanceChecks
    },
    cleanup: {
      status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true,
      observedWorkerPids: [workerPid], liveObservedWorkerPids: []
    },
    artifacts: [{ name: 'fixture.json', path: null, sha256: 'd'.repeat(64) }],
    verdict,
    blocker: null
  };

  if (candidate === 'Temporal TypeScript') Object.assign(base.cleanup, { temporalServerCleanup: true, sqliteCleanup: true, workspaceCleanup: true });
  if (candidate === 'DBOS TypeScript') Object.assign(base.cleanup, { cleanupContainerAllowed: true, databaseDrop: true, databaseAbsent: true, postgresContainerCleanup: true, workspaceCleanup: true });

  return {
    ...base,
    ...setupOverrides.record,
    setup: {
      ...base.setup,
      ...setupOverrides,
      dependencyIdentity: dependencyIdentityOverrides ?? setupOverrides.dependencyIdentity ?? base.setup.dependencyIdentity,
      environment: { ...base.setup.environment, ...environmentOverrides, ...(setupOverrides.environment ?? {}) },
      parameters: { ...base.setup.parameters, ...parameterOverrides, ...(setupOverrides.parameters ?? {}) },
      preRunCleanupReceipt: setupOverrides.preRunCleanupReceipt === undefined
        ? base.setup.preRunCleanupReceipt
        : setupOverrides.preRunCleanupReceipt
    },
    run: {
      ...base.run,
      ...runOverrides,
      rawObservations: { ...base.run.rawObservations, ...(runOverrides.rawObservations ?? {}) },
      fault: { ...base.run.fault, ...(runOverrides.fault ?? {}) },
      acceptanceChecks: runOverrides.acceptanceChecks ?? base.run.acceptanceChecks
    },
    cleanup: { ...base.cleanup, ...cleanupOverrides }
  };
}

export function faultSuite(required = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16'], minRepetitions = 100) {
  return {
    mutants: required.map((id) => ({ id, critical: true, minRepetitions })),
    benchmarkEligibility: { forbidBlockedOrInconclusive: required }
  };
}

export function completeCandidateRecords(candidate = 'Temporal TypeScript', minRepetitions = 100, verdictByMutant = {}) {
  const required = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16'];
  return required.flatMap((mutantId) => Array.from({ length: minRepetitions }, (_, index) => readyFormalRecord({
    candidate,
    mutantId,
    repetition: index + 1,
    verdict: verdictByMutant[mutantId] ?? 'PASS',
    workerPid: 10000 + required.indexOf(mutantId) * 1000 + index + 1
  })));
}

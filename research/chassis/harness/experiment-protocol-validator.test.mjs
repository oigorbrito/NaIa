import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveSeed, validateExperimentProtocol } from './experiment-protocol-validator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassis = path.resolve(here, '..');
const REVISION_POLICY = 'single-verified-git-revision-per-formal-ledger';
const ENVIRONMENT_POLICY = 'single-common-runtime-and-candidate-profile-per-formal-ledger';
const EVALUATOR_POLICY = 'candidate-agnostic-evaluator-authority';

async function json(name) {
  return JSON.parse(await readFile(path.join(chassis, name), 'utf8'));
}

test('protocol matches fault-suite and freezes revision, environment and evaluator authority before execution', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.expectedExperiments, 4 * 6 * 100);
  assert.equal(result.uniqueSeeds, 4 * 6 * 100);
  assert.equal(protocol.executionOrder.repositoryRevisionPolicy, REVISION_POLICY);
  assert.equal(protocol.executionOrder.environmentIdentityPolicy, ENVIRONMENT_POLICY);
  assert.equal(protocol.executionOrder.evaluatorAuthorityPolicy, EVALUATOR_POLICY);
  assert.deepEqual(protocol.requiredRecordFields, [
    'experimentId', 'candidate', 'mutantId', 'repetition',
    'setup.candidateVersion', 'setup.candidateSourceRef', 'setup.adapterSha256', 'setup.harnessSha256',
    'setup.dependencyIdentity', 'setup.environment', 'setup.parameters', 'setup.preRunCleanupReceipt',
    'run.startedAt', 'run.finishedAt', 'run.fault', 'run.workload', 'run.rawObservations', 'run.acceptanceChecks',
    'cleanup', 'artifacts', 'verdict'
  ]);

  const revision = protocol.methodology.preExecutionAmendments.find((entry) => entry.id === 'A001');
  assert.equal(revision.date, '2026-09-01');
  assert.equal(revision.status, 'FROZEN_BEFORE_FORMAL_EXECUTION');
  assert.equal(revision.policy, REVISION_POLICY);
  assert.equal(revision.outcomeDriven, false);
  assert.equal(revision.changesSemanticVerdicts, false);
  assert.equal(revision.changesRepetitionThreshold, false);
  assert.equal(revision.lifecycleQualificationMayPrecedeBenchmarkRevision, true);

  const environment = protocol.methodology.preExecutionAmendments.find((entry) => entry.id === 'A002');
  assert.equal(environment.date, '2026-09-01');
  assert.equal(environment.status, 'FROZEN_BEFORE_FORMAL_EXECUTION');
  assert.equal(environment.policy, ENVIRONMENT_POLICY);
  assert.equal(environment.outcomeDriven, false);
  assert.equal(environment.changesSemanticVerdicts, false);
  assert.equal(environment.changesRepetitionThreshold, false);
  assert.match(environment.constraint, /Dynamic workspace paths, ports, task queues, process IDs, container IDs and database URLs are excluded/);

  const evaluator = protocol.methodology.preExecutionAmendments.find((entry) => entry.id === 'A003');
  assert.equal(evaluator.date, '2026-09-01');
  assert.equal(evaluator.status, 'FROZEN_BEFORE_FORMAL_EXECUTION');
  assert.equal(evaluator.policy, EVALUATOR_POLICY);
  assert.equal(evaluator.outcomeDriven, false);
  assert.equal(evaluator.changesSemanticVerdicts, false);
  assert.equal(evaluator.changesRepetitionThreshold, false);
  assert.match(evaluator.constraint, /candidate-agnostic evaluator code from raw observations/);
  assert.match(evaluator.constraint, /RECONCILIATION_REQUIRED is observable evidence but is not T7\/T8 PASS/);
});

test('seed derivation is stable for the same candidate mutant and repetition', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  assert.equal(deriveSeed(protocol, 'Temporal TypeScript', 'T7', 1), 1_070_001);
  assert.equal(deriveSeed(protocol, 'Trigger.dev', 'T16', 100), 4_160_100);
});

test('protocol validation rejects a repetition minimum below the fault-suite declaration', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  protocol.repetitionPolicy.minimumPerCriticalMutant = 99;
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /protocol minimum does not match/);
});

test('protocol validation rejects seed ordinal collisions', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  protocol.repetitionPolicy.seedPolicy.candidateOrdinals['DBOS TypeScript'] = 1;
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /candidate seed ordinals must be unique|seed collision/);
});

test('protocol validation rejects silent removal of frozen revision, environment or evaluator policies', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  delete protocol.executionOrder.repositoryRevisionPolicy;
  delete protocol.executionOrder.environmentIdentityPolicy;
  delete protocol.executionOrder.evaluatorAuthorityPolicy;
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /executionOrder\.repositoryRevisionPolicy must equal/);
  assert.match(result.errors.join('\n'), /executionOrder\.environmentIdentityPolicy must equal/);
  assert.match(result.errors.join('\n'), /executionOrder\.evaluatorAuthorityPolicy must equal/);
});

test('protocol validation rejects removal or post-hoc mutation of A001 A002 and A003', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  protocol.methodology.preExecutionAmendments = [];
  let result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /A001: frozen pre-execution amendment is required/);
  assert.match(result.errors.join('\n'), /A002: frozen pre-execution amendment is required/);
  assert.match(result.errors.join('\n'), /A003: frozen pre-execution amendment is required/);

  const mutatedRevision = await json('experiment-protocol.v1.json');
  const a001 = mutatedRevision.methodology.preExecutionAmendments.find((entry) => entry.id === 'A001');
  a001.outcomeDriven = true;
  a001.changesRepetitionThreshold = true;
  a001.constraint = 'weakened after outcomes';
  result = validateExperimentProtocol(mutatedRevision, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /A001: outcomeDriven must be false/);
  assert.match(result.errors.join('\n'), /A001: changesRepetitionThreshold must be false/);
  assert.match(result.errors.join('\n'), /A001: frozen constraint text changed/);

  const mutatedEnvironment = await json('experiment-protocol.v1.json');
  const a002 = mutatedEnvironment.methodology.preExecutionAmendments.find((entry) => entry.id === 'A002');
  a002.policy = 'post-hoc-environment-policy';
  a002.outcomeDriven = true;
  a002.constraint = 'ignore runtime drift if results look similar';
  result = validateExperimentProtocol(mutatedEnvironment, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /A002: policy must equal/);
  assert.match(result.errors.join('\n'), /A002: outcomeDriven must be false/);
  assert.match(result.errors.join('\n'), /A002: frozen constraint text changed/);

  const mutatedEvaluator = await json('experiment-protocol.v1.json');
  const a003 = mutatedEvaluator.methodology.preExecutionAmendments.find((entry) => entry.id === 'A003');
  a003.policy = 'candidate-specific-evaluator-allowed';
  a003.outcomeDriven = true;
  a003.constraint = 'runner may override checks for preferred candidates';
  result = validateExperimentProtocol(mutatedEvaluator, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /A003: policy must equal/);
  assert.match(result.errors.join('\n'), /A003: outcomeDriven must be false/);
  assert.match(result.errors.join('\n'), /A003: frozen constraint text changed/);
});

test('protocol validation rejects silent mutation of the frozen formal record contract', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  protocol.requiredRecordFields = protocol.requiredRecordFields.filter((field) => field !== 'setup.dependencyIdentity');
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /requiredRecordFields must remain the frozen formal record contract/);
});

const EXPECTED_DECISION = 'NOT_SELECTED';
const EXPECTED_REVISION_POLICY = 'single-verified-git-revision-per-formal-ledger';
const EXPECTED_ENVIRONMENT_POLICY = 'single-common-runtime-and-candidate-profile-per-formal-ledger';
const EXPECTED_EVALUATOR_POLICY = 'candidate-agnostic-evaluator-authority';
const EXPECTED_AMENDMENT_DATE = '2026-09-01';
const EXPECTED_A001_CONSTRAINT = 'The T5/r1 lifecycle qualification support may originate from an earlier verified revision only while its candidate lifecycle-qualification hash remains current; every record admitted to one formal benchmark ledger must otherwise share one verified Git repository revision.';
const EXPECTED_A002_CONSTRAINT = 'Every READY record in one formal ledger must share one canonical common execution environment identity for OS, architecture, Node runtime and recorded package-manager identity; within each candidate, every READY record must also share one canonical candidate profile derived from candidate/source identity, adapter SHA-256, manifest and exact installed dependency versions, declared mode/authority boundary, lifecycle-qualification SHA-256 and stable observed native runtime identity. Dynamic workspace paths, ports, task queues, process IDs, container IDs and database URLs are excluded from identity.';
const EXPECTED_A003_CONSTRAINT = 'Formal semantic acceptance for every benchmark-critical mutant must be computed by candidate-agnostic evaluator code from raw observations; candidate adapters and execution runners may translate native evidence but must not define or override success semantics. Fault injection is classified separately, and an absent intended fault remains INCONCLUSIVE. For T7 and T8, the frozen executable acceptance contract requires exactly one external apply, one stable semantic operation identity, reachable durable authority, objective_completed terminal recovery and COMPLETED final status; T7 additionally requires zero response losses, while T8 additionally requires that the measurement cutoff was not reached after the one required response-loss fault. RECONCILIATION_REQUIRED is observable evidence but is not T7/T8 PASS under this V1 contract.';
const EXPECTED_REQUIRED_RECORD_FIELDS = Object.freeze([
  'experimentId',
  'candidate',
  'mutantId',
  'repetition',
  'setup.candidateVersion',
  'setup.candidateSourceRef',
  'setup.adapterSha256',
  'setup.harnessSha256',
  'setup.dependencyIdentity',
  'setup.environment',
  'setup.parameters',
  'setup.preRunCleanupReceipt',
  'run.startedAt',
  'run.finishedAt',
  'run.fault',
  'run.workload',
  'run.rawObservations',
  'run.acceptanceChecks',
  'cleanup',
  'artifacts',
  'verdict'
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function deriveSeed(protocol, candidate, mutantId, repetition) {
  const candidateOrdinal = protocol?.repetitionPolicy?.seedPolicy?.candidateOrdinals?.[candidate];
  const mutantOrdinal = protocol?.repetitionPolicy?.seedPolicy?.mutantOrdinals?.[mutantId];
  if (!Number.isInteger(candidateOrdinal) || !Number.isInteger(mutantOrdinal) || !Number.isInteger(repetition) || repetition < 1) {
    throw new Error('cannot derive seed from incomplete protocol identity');
  }
  return candidateOrdinal * 1_000_000 + mutantOrdinal * 10_000 + repetition;
}

function amendmentById(protocol, id, errors) {
  const amendments = protocol?.methodology?.preExecutionAmendments;
  if (!Array.isArray(amendments)) {
    errors.push('methodology.preExecutionAmendments must be an array');
    return null;
  }
  const amendment = amendments.find((entry) => entry?.id === id);
  if (!amendment) errors.push(`${id}: frozen pre-execution amendment is required`);
  return amendment ?? null;
}

function validateCommonAmendment(amendment, id, expectedPolicy, expectedConstraint, errors) {
  if (!amendment) return;
  if (amendment.status !== 'FROZEN_BEFORE_FORMAL_EXECUTION') errors.push(`${id}: status must be FROZEN_BEFORE_FORMAL_EXECUTION`);
  if (amendment.policy !== expectedPolicy) errors.push(`${id}: policy must equal ${expectedPolicy}`);
  if (amendment.date !== EXPECTED_AMENDMENT_DATE) errors.push(`${id}: date must remain ${EXPECTED_AMENDMENT_DATE}`);
  if (!nonEmpty(amendment.reason)) errors.push(`${id}: reason is required`);
  if (amendment.constraint !== expectedConstraint) errors.push(`${id}: frozen constraint text changed`);
  if (amendment.outcomeDriven !== false) errors.push(`${id}: outcomeDriven must be false`);
  if (amendment.changesSemanticVerdicts !== false) errors.push(`${id}: changesSemanticVerdicts must be false`);
  if (amendment.changesRepetitionThreshold !== false) errors.push(`${id}: changesRepetitionThreshold must be false`);
}

function validatePreExecutionAmendments(protocol, errors) {
  if (protocol?.executionOrder?.repositoryRevisionPolicy !== EXPECTED_REVISION_POLICY) {
    errors.push(`executionOrder.repositoryRevisionPolicy must equal ${EXPECTED_REVISION_POLICY}`);
  }
  if (protocol?.executionOrder?.environmentIdentityPolicy !== EXPECTED_ENVIRONMENT_POLICY) {
    errors.push(`executionOrder.environmentIdentityPolicy must equal ${EXPECTED_ENVIRONMENT_POLICY}`);
  }
  if (protocol?.executionOrder?.evaluatorAuthorityPolicy !== EXPECTED_EVALUATOR_POLICY) {
    errors.push(`executionOrder.evaluatorAuthorityPolicy must equal ${EXPECTED_EVALUATOR_POLICY}`);
  }

  const revision = amendmentById(protocol, 'A001', errors);
  validateCommonAmendment(revision, 'A001', EXPECTED_REVISION_POLICY, EXPECTED_A001_CONSTRAINT, errors);
  if (revision && revision.lifecycleQualificationMayPrecedeBenchmarkRevision !== true) {
    errors.push('A001: lifecycleQualificationMayPrecedeBenchmarkRevision must be true');
  }

  const environment = amendmentById(protocol, 'A002', errors);
  validateCommonAmendment(environment, 'A002', EXPECTED_ENVIRONMENT_POLICY, EXPECTED_A002_CONSTRAINT, errors);

  const evaluator = amendmentById(protocol, 'A003', errors);
  validateCommonAmendment(evaluator, 'A003', EXPECTED_EVALUATOR_POLICY, EXPECTED_A003_CONSTRAINT, errors);
}

function validateRequiredRecordFields(protocol, errors) {
  const actual = protocol?.requiredRecordFields;
  if (!Array.isArray(actual)) {
    errors.push('requiredRecordFields must be an array');
    return;
  }
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_REQUIRED_RECORD_FIELDS)) {
    errors.push('requiredRecordFields must remain the frozen formal record contract');
  }
}

export function validateExperimentProtocol(protocol, faultSuite) {
  const errors = [];
  if (!protocol || typeof protocol !== 'object') return { valid: false, errors: ['protocol must be an object'] };
  if (protocol.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (protocol.status !== 'SPECIFIED_NOT_EXECUTED') errors.push('protocol status must remain SPECIFIED_NOT_EXECUTED before runtime execution');
  if (protocol.decisionState?.benchmarkToBeat !== EXPECTED_DECISION) errors.push('benchmarkToBeat must remain NOT_SELECTED');
  if (protocol.decisionState?.chassisWinner !== EXPECTED_DECISION) errors.push('chassisWinner must remain NOT_SELECTED');

  const candidates = protocol.candidates ?? [];
  if (!Array.isArray(candidates) || candidates.length === 0 || new Set(candidates).size !== candidates.length || candidates.some((value) => !nonEmpty(value))) {
    errors.push('candidates must be a non-empty unique string list');
  }

  const suiteCritical = (faultSuite?.mutants ?? []).filter((mutant) => mutant.critical).map((mutant) => mutant.id).sort();
  const protocolCritical = [...(protocol.criticalMutants ?? [])].sort();
  if (JSON.stringify(protocolCritical) !== JSON.stringify(suiteCritical)) errors.push('criticalMutants must exactly match fault-suite critical mutants');

  const declaredMinimum = protocol?.repetitionPolicy?.minimumPerCriticalMutant;
  for (const mutant of (faultSuite?.mutants ?? []).filter((entry) => entry.critical)) {
    if (!Number.isInteger(mutant.minRepetitions) || mutant.minRepetitions < 1) errors.push(`${mutant.id}: fault-suite minRepetitions is invalid`);
    if (declaredMinimum !== mutant.minRepetitions) errors.push(`${mutant.id}: protocol minimum does not match fault-suite minRepetitions`);
  }

  const candidateOrdinals = protocol?.repetitionPolicy?.seedPolicy?.candidateOrdinals ?? {};
  const mutantOrdinals = protocol?.repetitionPolicy?.seedPolicy?.mutantOrdinals ?? {};
  if (candidates.some((candidate) => !Number.isInteger(candidateOrdinals[candidate]))) errors.push('every candidate requires an integer seed ordinal');
  if (protocolCritical.some((mutantId) => !Number.isInteger(mutantOrdinals[mutantId]))) errors.push('every critical mutant requires an integer seed ordinal');
  if (new Set(Object.values(candidateOrdinals)).size !== Object.values(candidateOrdinals).length) errors.push('candidate seed ordinals must be unique');
  if (new Set(Object.values(mutantOrdinals)).size !== Object.values(mutantOrdinals).length) errors.push('mutant seed ordinals must be unique');

  const seedSet = new Set();
  if (Number.isInteger(declaredMinimum) && declaredMinimum > 0) {
    for (const candidate of candidates) {
      for (const mutantId of protocolCritical) {
        for (let repetition = 1; repetition <= declaredMinimum; repetition += 1) {
          try {
            const seed = deriveSeed(protocol, candidate, mutantId, repetition);
            if (!Number.isSafeInteger(seed) || seed < 0) errors.push(`${candidate}/${mutantId}/${repetition}: invalid seed`);
            if (seedSet.has(seed)) errors.push(`${candidate}/${mutantId}/${repetition}: seed collision ${seed}`);
            seedSet.add(seed);
          } catch (error) {
            errors.push(`${candidate}/${mutantId}/${repetition}: ${error.message}`);
          }
        }
      }
    }
  }

  if (protocol.executionOrder?.policy !== 'round-robin-by-repetition') errors.push('executionOrder.policy must be round-robin-by-repetition');
  if (!nonEmpty(protocol.executionOrder?.sequence)) errors.push('executionOrder.sequence is required');
  validatePreExecutionAmendments(protocol, errors);
  validateRequiredRecordFields(protocol, errors);

  return {
    valid: errors.length === 0,
    errors,
    expectedExperiments: Number.isInteger(declaredMinimum) ? candidates.length * protocolCritical.length * declaredMinimum : 0,
    uniqueSeeds: seedSet.size
  };
}

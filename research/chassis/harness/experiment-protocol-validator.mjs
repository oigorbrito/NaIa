const EXPECTED_DECISION = 'NOT_SELECTED';
const EXPECTED_REVISION_POLICY = 'single-verified-git-revision-per-formal-ledger';
const EXPECTED_AMENDMENT_ID = 'A001';

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

function validatePreExecutionRevisionAmendment(protocol, errors) {
  if (protocol?.executionOrder?.repositoryRevisionPolicy !== EXPECTED_REVISION_POLICY) {
    errors.push(`executionOrder.repositoryRevisionPolicy must equal ${EXPECTED_REVISION_POLICY}`);
  }

  const amendments = protocol?.methodology?.preExecutionAmendments;
  if (!Array.isArray(amendments)) {
    errors.push('methodology.preExecutionAmendments must be an array');
    return;
  }

  const amendment = amendments.find((entry) => entry?.id === EXPECTED_AMENDMENT_ID);
  if (!amendment) {
    errors.push(`${EXPECTED_AMENDMENT_ID}: frozen pre-execution repository revision amendment is required`);
    return;
  }

  if (amendment.status !== 'FROZEN_BEFORE_FORMAL_EXECUTION') {
    errors.push(`${EXPECTED_AMENDMENT_ID}: status must be FROZEN_BEFORE_FORMAL_EXECUTION`);
  }
  if (amendment.policy !== EXPECTED_REVISION_POLICY) {
    errors.push(`${EXPECTED_AMENDMENT_ID}: policy must equal ${EXPECTED_REVISION_POLICY}`);
  }
  if (!nonEmpty(amendment.date)) errors.push(`${EXPECTED_AMENDMENT_ID}: date is required`);
  if (!nonEmpty(amendment.reason)) errors.push(`${EXPECTED_AMENDMENT_ID}: reason is required`);
  if (!nonEmpty(amendment.constraint)) errors.push(`${EXPECTED_AMENDMENT_ID}: constraint is required`);
  if (amendment.outcomeDriven !== false) errors.push(`${EXPECTED_AMENDMENT_ID}: outcomeDriven must be false`);
  if (amendment.changesSemanticVerdicts !== false) errors.push(`${EXPECTED_AMENDMENT_ID}: changesSemanticVerdicts must be false`);
  if (amendment.changesRepetitionThreshold !== false) errors.push(`${EXPECTED_AMENDMENT_ID}: changesRepetitionThreshold must be false`);
  if (amendment.lifecycleQualificationMayPrecedeBenchmarkRevision !== true) {
    errors.push(`${EXPECTED_AMENDMENT_ID}: lifecycleQualificationMayPrecedeBenchmarkRevision must be true`);
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
  validatePreExecutionRevisionAmendment(protocol, errors);

  return {
    valid: errors.length === 0,
    errors,
    expectedExperiments: Number.isInteger(declaredMinimum) ? candidates.length * protocolCritical.length * declaredMinimum : 0,
    uniqueSeeds: seedSet.size
  };
}

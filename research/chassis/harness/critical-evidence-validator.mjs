const CRITICAL = new Set(['T5', 'T7', 'T8', 'T11', 'T12', 'T16']);
const VERDICTS = new Set(['PASS', 'PARTIAL', 'FAIL', 'BLOCKED', 'INCONCLUSIVE', 'NOT_EXECUTED']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateCriticalEvidence(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return { valid: false, errors: ['record must be an object'] };

  if (!CRITICAL.has(record.mutant)) errors.push('mutant must be benchmark-critical');
  if (!VERDICTS.has(record.verdict)) errors.push('verdict is invalid');
  if (!nonEmpty(record.candidate)) errors.push('candidate is required');
  if (!nonEmpty(record.profile)) errors.push('profile is required');

  const executed = record.verdict !== 'BLOCKED' && record.verdict !== 'INCONCLUSIVE' && record.verdict !== 'NOT_EXECUTED';
  if (executed) {
    if (!nonEmpty(record.startedAt) || !nonEmpty(record.finishedAt)) errors.push('executed evidence requires timestamps');
    if (!nonEmpty(record.runtimeIdentity)) errors.push('executed evidence requires runtimeIdentity');
    if (!nonEmpty(record.sourceRef)) errors.push('executed evidence requires sourceRef');
    if (!nonEmpty(record.faultPrimitive)) errors.push('executed evidence requires faultPrimitive');
    if (!nonEmpty(record.durableAuthority)) errors.push('executed evidence requires durableAuthority');
    if (!nonEmpty(record.authorityUnderFault)) errors.push('executed evidence requires authorityUnderFault');
    if (!record.reproduction || typeof record.reproduction !== 'object') errors.push('executed evidence requires reproduction metadata');
  }

  if (record.verdict === 'PASS') {
    if (!record.checks || typeof record.checks !== 'object' || Object.keys(record.checks).length === 0) {
      errors.push('PASS requires machine-readable checks');
    } else if (!Object.values(record.checks).every((value) => value === true)) {
      errors.push('PASS requires every check to be true');
    }
    if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) errors.push('PASS requires at least one artifact');
  }

  if (record.mutant === 'T7' && record.mode === 'managed-controller' && record.candidate === 'Trigger.dev') {
    if (record.verdict === 'PASS' && !record.workerKillEvidence) {
      errors.push('Trigger.dev T7 PASS requires workerKillEvidence');
    }
    if (record.workerKillEvidence && /controller/i.test(String(record.workerKillEvidence.target ?? ''))) {
      errors.push('controller process is not a valid Trigger.dev T7 kill target');
    }
  }

  if (record.mutant === 'T16' && record.verdict === 'PASS') {
    if (!record.mutation || typeof record.mutation !== 'object') errors.push('T16 PASS requires explicit mutation metadata');
    if (!nonEmpty(record.semanticCompatibilityOutcome)) errors.push('T16 PASS requires semanticCompatibilityOutcome');
  }

  return { valid: errors.length === 0, errors };
}

export function benchmarkEligible(records, candidates) {
  const missing = [];
  for (const candidate of candidates) {
    for (const mutant of CRITICAL) {
      const match = records.find((record) => record.candidate === candidate && record.mutant === mutant);
      if (!match || ['BLOCKED', 'INCONCLUSIVE', 'NOT_EXECUTED'].includes(match.verdict)) {
        missing.push({ candidate, mutant, verdict: match?.verdict ?? 'MISSING' });
      }
    }
  }
  return { eligible: missing.length === 0, missing };
}

import { validateExecutionLedger } from './experiment-ledger-validator.mjs';
import { benchmarkEligible } from './experiment-record-validator.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function policyFor(map, candidate, mutantId) {
  return map?.[candidate]?.[mutantId] ?? null;
}

function validExceptionPolicy(policy) {
  return policy && policy.enforced === true && nonEmpty(policy.justification) && nonEmpty(policy.constraint);
}

export function assessCandidatePromotion(records, faultSuite, { acceptedFailures = {}, enforcedPolicies = {} } = {}) {
  const comparability = benchmarkEligible(records, faultSuite);
  const candidate = comparability.candidate ?? records?.[0]?.candidate ?? null;
  const errors = [...comparability.errors];
  const exceptions = [];

  if (!candidate) return { qualified: false, comparable: false, candidate: null, errors: [...errors, 'candidate unavailable'], exceptions };

  for (const record of records ?? []) {
    if (record.verdict === 'FAIL') {
      const policy = policyFor(acceptedFailures, candidate, record.mutantId);
      if (!validExceptionPolicy(policy)) {
        errors.push(`${record.mutantId}: critical FAIL requires explicit enforced acceptance/exclusion policy before promotion`);
      } else {
        exceptions.push({ mutantId: record.mutantId, verdict: 'FAIL', policy });
      }
    }
    if (record.verdict === 'PARTIAL') {
      const partialAllowed = new Set(faultSuite?.benchmarkEligibility?.partialAllowedWithEnforcedPolicy ?? []);
      const policy = policyFor(enforcedPolicies, candidate, record.mutantId);
      if (!partialAllowed.has(record.mutantId) || !validExceptionPolicy(policy)) {
        errors.push(`${record.mutantId}: PARTIAL requires a predeclared allowed mutant plus enforced policy`);
      } else {
        exceptions.push({ mutantId: record.mutantId, verdict: 'PARTIAL', policy });
      }
    }
  }

  return {
    candidate,
    comparable: comparability.eligible,
    qualified: comparability.eligible && errors.length === 0,
    exceptions,
    errors
  };
}

export function assessBenchmarkPromotion({ ledger, protocol, faultSuite, acceptedFailures = {}, enforcedPolicies = {} }) {
  const ledgerValidation = validateExecutionLedger(ledger, protocol, faultSuite, { allowPrefix: false });
  if (!ledgerValidation.valid || !ledgerValidation.complete) {
    return {
      readyForSelection: false,
      ledger: ledgerValidation,
      candidates: [],
      qualifiedCandidates: [],
      errors: ['benchmark ledger is not a complete valid preregistered execution']
    };
  }

  const candidateResults = [];
  for (const candidate of protocol.candidates ?? []) {
    const records = ledger.filter((record) => record.candidate === candidate);
    candidateResults.push(assessCandidatePromotion(records, faultSuite, { acceptedFailures, enforcedPolicies }));
  }
  const qualifiedCandidates = candidateResults.filter((entry) => entry.qualified).map((entry) => entry.candidate);

  return {
    readyForSelection: qualifiedCandidates.length > 0,
    ledger: ledgerValidation,
    candidates: candidateResults,
    qualifiedCandidates,
    errors: qualifiedCandidates.length > 0 ? [] : ['no candidate satisfies promotion rules']
  };
}

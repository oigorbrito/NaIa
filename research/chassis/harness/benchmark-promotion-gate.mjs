import { readFileSync } from 'node:fs';
import {
  assessStoredFormalLedgerCurrentCompatibility,
  assessStoredFormalLedgerEnvironmentConsistency,
  assessStoredFormalLedgerHarnessConsistency,
  auditStoredFormalLedger,
  validateExecutionLedger
} from './experiment-ledger-validator.mjs';
import { FORMAL_CLEANUP_SUPPORT } from './formal-cleanup-support.mjs';
import { benchmarkEligible, benchmarkRepositoryRevisions } from './experiment-record-validator.mjs';

const PROMOTION_POLICY_URL = new URL('../formal-promotion-policy.v1.json', import.meta.url);

export const FORMAL_PROMOTION_POLICY = Object.freeze(
  JSON.parse(readFileSync(PROMOTION_POLICY_URL, 'utf8'))
);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyMap(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0;
}

function policyFor(map, candidate, mutantId) {
  return map?.[candidate]?.[mutantId] ?? null;
}

function validExceptionPolicy(policy) {
  return policy && policy.enforced === true && nonEmpty(policy.justification) && nonEmpty(policy.constraint);
}

export function assessBenchmarkRepositoryRevisionConsistency(records) {
  const repositoryRevisions = benchmarkRepositoryRevisions(records);
  return {
    consistent: repositoryRevisions.length <= 1,
    repositoryRevision: repositoryRevisions.length === 1 ? repositoryRevisions[0] : null,
    repositoryRevisions,
    errors: repositoryRevisions.length <= 1
      ? []
      : [`benchmark comparison spans multiple Git repository revisions: ${repositoryRevisions.join(', ')}`]
  };
}

export function assessCandidatePromotion(
  records,
  faultSuite,
  {
    acceptedFailures = {},
    enforcedPolicies = {},
    cleanupSupport = FORMAL_CLEANUP_SUPPORT
  } = {}
) {
  const comparability = benchmarkEligible(records, faultSuite, cleanupSupport);
  const candidate = comparability.candidate ?? records?.[0]?.candidate ?? null;
  const errors = [...comparability.errors];
  const exceptions = [];

  if (!candidate) return { qualified: false, comparable: false, candidate: null, errors: [...errors, 'candidate unavailable'], exceptions };

  if (nonEmptyMap(acceptedFailures) || nonEmptyMap(enforcedPolicies)) {
    errors.push('runtime promotion policy overrides are non-authoritative; exceptions must be frozen in formal-promotion-policy.v1.json before formal execution');
  }

  const verdictsByMutant = new Map();
  for (const record of records ?? []) {
    if (!verdictsByMutant.has(record.mutantId)) verdictsByMutant.set(record.mutantId, new Set());
    verdictsByMutant.get(record.mutantId).add(record.verdict);
  }

  const partialAllowed = new Set(faultSuite?.benchmarkEligibility?.partialAllowedWithEnforcedPolicy ?? []);
  for (const [mutantId, verdicts] of verdictsByMutant) {
    if (verdicts.has('FAIL')) {
      const policy = policyFor(FORMAL_PROMOTION_POLICY.acceptedCriticalFailures, candidate, mutantId);
      if (!validExceptionPolicy(policy)) {
        errors.push(`${mutantId}: critical FAIL has no preregistered promotion exception`);
      } else {
        exceptions.push({ mutantId, verdict: 'FAIL', policy });
      }
    }
    if (verdicts.has('PARTIAL')) {
      const policy = policyFor(FORMAL_PROMOTION_POLICY.partialPolicies, candidate, mutantId);
      if (!partialAllowed.has(mutantId) || !validExceptionPolicy(policy)) {
        errors.push(`${mutantId}: PARTIAL lacks a preregistered enforced promotion policy`);
      } else {
        exceptions.push({ mutantId, verdict: 'PARTIAL', policy });
      }
    }
  }

  return {
    candidate,
    comparable: comparability.eligible,
    qualified: comparability.eligible && errors.length === 0,
    environmentConsistency: comparability.environmentConsistency,
    exceptions,
    promotionPolicyStatus: FORMAL_PROMOTION_POLICY.status,
    errors
  };
}

export function assessBenchmarkPromotion({
  ledger,
  protocol,
  faultSuite,
  acceptedFailures = {},
  enforcedPolicies = {},
  cleanupSupport = FORMAL_CLEANUP_SUPPORT
}) {
  const ledgerValidation = validateExecutionLedger(ledger, protocol, faultSuite, { allowPrefix: false });
  const historicalAudit = auditStoredFormalLedger(ledger);
  const currentCompatibility = assessStoredFormalLedgerCurrentCompatibility(ledger);
  const repositoryRevisionConsistency = assessBenchmarkRepositoryRevisionConsistency(ledger);
  const harnessConsistency = assessStoredFormalLedgerHarnessConsistency(ledger);
  const environmentConsistency = assessStoredFormalLedgerEnvironmentConsistency(ledger);
  if (
    !ledgerValidation.valid ||
    !ledgerValidation.complete ||
    !historicalAudit.valid ||
    !currentCompatibility.compatible ||
    !repositoryRevisionConsistency.consistent ||
    !harnessConsistency.consistent ||
    !environmentConsistency.consistent
  ) {
    return {
      readyForSelection: false,
      ledger: ledgerValidation,
      formalAudit: historicalAudit,
      currentCompatibility,
      repositoryRevisionConsistency,
      harnessConsistency,
      environmentConsistency,
      candidates: [],
      qualifiedCandidates: [],
      promotionPolicyStatus: FORMAL_PROMOTION_POLICY.status,
      errors: [
        !ledgerValidation.valid || !ledgerValidation.complete
          ? 'benchmark ledger is not a complete valid preregistered execution'
          : null,
        !historicalAudit.valid
          ? 'benchmark ledger historical formal provenance audit failed'
          : null,
        !currentCompatibility.compatible
          ? 'benchmark ledger is incompatible with current frozen qualification/promotion state'
          : null,
        !repositoryRevisionConsistency.consistent
          ? 'benchmark ledger mixes Git repository revisions and is not comparable'
          : null,
        !harnessConsistency.consistent
          ? 'benchmark ledger mixes formal harness identities and is not comparable'
          : null,
        !environmentConsistency.consistent
          ? 'benchmark ledger mixes formal execution environment or candidate profile identities and is not comparable'
          : null
      ].filter(Boolean)
    };
  }

  const candidateResults = [];
  for (const candidate of protocol.candidates ?? []) {
    const records = ledger.filter((record) => record.candidate === candidate);
    candidateResults.push(assessCandidatePromotion(records, faultSuite, {
      acceptedFailures,
      enforcedPolicies,
      cleanupSupport
    }));
  }
  const qualifiedCandidates = candidateResults.filter((entry) => entry.qualified).map((entry) => entry.candidate);

  return {
    readyForSelection: qualifiedCandidates.length > 0,
    ledger: ledgerValidation,
    formalAudit: historicalAudit,
    currentCompatibility,
    repositoryRevisionConsistency,
    harnessConsistency,
    environmentConsistency,
    candidates: candidateResults,
    qualifiedCandidates,
    promotionPolicyStatus: FORMAL_PROMOTION_POLICY.status,
    errors: qualifiedCandidates.length > 0 ? [] : ['no candidate satisfies promotion rules']
  };
}

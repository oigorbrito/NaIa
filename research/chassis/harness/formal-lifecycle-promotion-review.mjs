import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeHarnessProvenance } from './harness-provenance.mjs';
import { validateRuntimeLifecycleReceipt } from './formal-lifecycle-runtime-receipt-validator.mjs';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sha256Value(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function reviewLifecyclePromotion({
  recordText,
  validationText,
  executionRef,
  currentHarnessSha256,
  verifiedAt = new Date().toISOString()
}) {
  const record = JSON.parse(recordText);
  const suppliedValidation = JSON.parse(validationText);
  const recomputedValidation = validateRuntimeLifecycleReceipt(record);
  const normalizedExecutionRef = String(executionRef ?? '').trim();
  const normalizedHarnessSha256 = String(currentHarnessSha256 ?? '').trim().toLowerCase();

  const checks = {
    executionRefPresent: nonEmpty(normalizedExecutionRef),
    currentHarnessSha256Valid: sha256Value(normalizedHarnessSha256),
    recordHarnessMatchesCurrent:
      sha256Value(record?.setup?.harnessSha256) &&
      String(record.setup.harnessSha256).toLowerCase() === normalizedHarnessSha256,
    suppliedValidationEligible: suppliedValidation?.eligibleForLifecycleStatusPromotion === true,
    recomputedValidationEligible: recomputedValidation.eligibleForLifecycleStatusPromotion === true,
    candidateMatches: suppliedValidation?.candidate === record?.candidate && recomputedValidation.candidate === record?.candidate,
    mutantMatches: suppliedValidation?.mutantId === record?.mutantId && recomputedValidation.mutantId === record?.mutantId,
    repetitionMatches: suppliedValidation?.repetition === record?.repetition && recomputedValidation.repetition === record?.repetition,
    suppliedGateForbidsBenchmarkPromotion: suppliedValidation?.benchmarkPromotionAllowed === false,
    suppliedGateForbidsLedgerAppend: suppliedValidation?.ledgerAppendAllowed === false
  };

  const eligibleForSupportPromotion = Object.values(checks).every(Boolean);
  const verificationEvidence = eligibleForSupportPromotion
    ? {
        executionRef: normalizedExecutionRef,
        experimentId: record.experimentId,
        mutantId: record.mutantId,
        repetition: record.repetition,
        recordSha256: sha256(recordText),
        validatorSha256: sha256(validationText),
        harnessSha256: normalizedHarnessSha256,
        verifiedAt
      }
    : null;

  return {
    schemaVersion: 1,
    candidate: record?.candidate ?? null,
    experimentId: record?.experimentId ?? null,
    candidateSemanticVerdict: record?.verdict ?? null,
    candidateSemanticVerdictDoesNotControlLifecyclePromotion: true,
    checks,
    eligibleForSupportPromotion,
    proposedSupport: eligibleForSupportPromotion
      ? {
          preRunCleanup: true,
          postRunCleanup: true,
          status: 'RUNTIME_VERIFIED',
          verificationEvidence
        }
      : null,
    benchmarkPromotionAllowed: false,
    ledgerAppendAllowed: false,
    automaticRepositoryMutationAllowed: false,
    disposition: eligibleForSupportPromotion
      ? 'ELIGIBLE_FOR_EXPLICIT_FORMAL_CLEANUP_SUPPORT_UPDATE'
      : 'PROMOTION_REVIEW_REJECTED'
  };
}

export async function reviewLifecyclePromotionAgainstRepository({
  repositoryRoot,
  recordText,
  validationText,
  executionRef,
  verifiedAt = new Date().toISOString()
}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  const provenance = await computeHarnessProvenance(repositoryRoot);
  return reviewLifecyclePromotion({
    recordText,
    validationText,
    executionRef,
    currentHarnessSha256: provenance.aggregateSha256,
    verifiedAt
  });
}

async function main() {
  const [recordPath, validationPath, executionRefPath, outputPath] = process.argv.slice(2);
  if (!recordPath || !validationPath || !executionRefPath || !outputPath) {
    throw new Error('usage: node formal-lifecycle-promotion-review.mjs <record.json> <validation.json> <execution-ref.txt> <output.json>');
  }
  const [recordText, validationText, executionRef] = await Promise.all([
    readFile(path.resolve(recordPath), 'utf8'),
    readFile(path.resolve(validationPath), 'utf8'),
    readFile(path.resolve(executionRefPath), 'utf8')
  ]);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(here, '..', '..', '..');
  const result = await reviewLifecyclePromotionAgainstRepository({ repositoryRoot, recordText, validationText, executionRef });
  await writeFile(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.eligibleForSupportPromotion) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 3;
  });
}

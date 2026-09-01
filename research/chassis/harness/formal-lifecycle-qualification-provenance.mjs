import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAL_LIFECYCLE_QUALIFICATION_PROFILE = 'T5_R1_CLEANUP_SUPPORT_V1';

const COMMON_FILES = Object.freeze([
  'research/chassis/harness/formal-lifecycle-qualification-provenance.mjs',
  'research/chassis/harness/candidate-experiment.mjs',
  'research/chassis/harness/candidate-setup.mjs',
  'research/chassis/harness/common-runner-run-hook.mjs',
  'research/chassis/harness/experiment-executor.mjs',
  'research/chassis/harness/experiment-protocol-validator.mjs',
  'research/chassis/harness/experiment-record-validator.mjs',
  'research/chassis/harness/formal-executor-support.mjs',
  'research/chassis/harness/formal-lifecycle-promotion-review.mjs',
  'research/chassis/harness/formal-lifecycle-runtime-receipt-validator.mjs',
  'research/chassis/harness/formal-runtime-lifecycle-router.mjs',
  'research/chassis/harness/formal-single-run.mjs',
  'research/chassis/harness/formal-worker-pid-provenance.mjs',
  'research/chassis/harness/harness-provenance.mjs',
  'research/chassis/harness/t5-evaluator.mjs',
  'research/chassis/harness/t5-record-bridge.mjs',
  'research/chassis/adapter-capabilities.v1.json',
  'research/chassis/experiment-protocol.v1.json',
  'research/chassis/fault-suite.v1.json',
  'research/chassis/T5-OWNERSHIP-CONTRACT-V1.md'
]);

export const FORMAL_LIFECYCLE_QUALIFICATION_FILES = Object.freeze({
  'Temporal TypeScript': Object.freeze([
    ...COMMON_FILES,
    'research/chassis/harness/formal-runtime-lifecycle.mjs',
    'research/chassis/adapters/temporal-ts/package.json',
    'research/chassis/adapters/temporal-ts/package-lock.json',
    'research/chassis/adapters/temporal-ts/adapter.mjs',
    'research/chassis/adapters/temporal-ts/t5-activities.mjs',
    'research/chassis/adapters/temporal-ts/t5-two-worker-driver.mjs',
    'research/chassis/adapters/temporal-ts/t5-worker-process.mjs',
    'research/chassis/adapters/temporal-ts/t5-workflow.mjs'
  ]),
  'DBOS TypeScript': Object.freeze([
    ...COMMON_FILES,
    'research/chassis/harness/formal-dbos-lifecycle.mjs',
    'research/chassis/adapters/dbos-ts/package.json',
    'research/chassis/adapters/dbos-ts/package-lock.json',
    'research/chassis/adapters/dbos-ts/adapter.mjs',
    'research/chassis/adapters/dbos-ts/t5-two-worker-driver.mjs',
    'research/chassis/adapters/dbos-ts/t5-worker-process.mjs',
    'research/chassis/adapters/dbos-ts/t5-workflow.mjs'
  ])
});

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function defaultRepositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export function lifecycleQualificationFiles(candidateName) {
  const files = FORMAL_LIFECYCLE_QUALIFICATION_FILES[candidateName];
  return files ? [...files] : null;
}

export function computeLifecycleQualificationProvenance(repositoryRoot, candidateName) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  const files = lifecycleQualificationFiles(candidateName);
  if (!files) return null;

  const entries = [];
  for (const relativePath of [...files].sort()) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const content = readFileSync(absolutePath);
    entries.push({ path: relativePath, sha256: sha256(content), bytes: content.length });
  }
  const canonical = entries.map((entry) => `${entry.path}\t${entry.sha256}\t${entry.bytes}`).join('\n') + '\n';
  return {
    profile: FORMAL_LIFECYCLE_QUALIFICATION_PROFILE,
    candidate: candidateName,
    algorithm: 'sha256',
    canonicalization: 'sorted path<TAB>sha256<TAB>bytes newline',
    fileCount: entries.length,
    files: entries,
    aggregateSha256: sha256(Buffer.from(canonical, 'utf8'))
  };
}

export function currentLifecycleQualificationProvenance(candidateName) {
  return computeLifecycleQualificationProvenance(defaultRepositoryRoot(), candidateName);
}

export function currentLifecycleQualificationSha256(candidateName) {
  return currentLifecycleQualificationProvenance(candidateName)?.aggregateSha256 ?? null;
}

export function lifecycleQualificationRecordProvenance(repositoryRoot, candidateName) {
  const provenance = computeLifecycleQualificationProvenance(repositoryRoot, candidateName);
  if (!provenance) return null;
  return {
    profile: provenance.profile,
    candidate: provenance.candidate,
    sha256: provenance.aggregateSha256,
    fileCount: provenance.fileCount
  };
}

export function lifecycleQualificationRecordProvenanceValid(value, candidateName, expectedSha256 = currentLifecycleQualificationSha256(candidateName)) {
  return Boolean(
    value &&
    expectedSha256 &&
    value.profile === FORMAL_LIFECYCLE_QUALIFICATION_PROFILE &&
    value.candidate === candidateName &&
    value.sha256 === expectedSha256 &&
    Number.isInteger(value.fileCount) && value.fileCount > 0
  );
}

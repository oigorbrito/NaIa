import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const FORMAL_HARNESS_FILES = Object.freeze([
  'research/chassis/harness/benchmark-execution-readiness.mjs',
  'research/chassis/harness/benchmark-promotion-gate.mjs',
  'research/chassis/harness/candidate-experiment.mjs',
  'research/chassis/harness/candidate-setup.mjs',
  'research/chassis/harness/common-runner.mjs',
  'research/chassis/harness/common-runner-record-bridge.mjs',
  'research/chassis/harness/common-runner-run-hook.mjs',
  'research/chassis/harness/crash-controller.mjs',
  'research/chassis/harness/experiment-executor.mjs',
  'research/chassis/harness/experiment-ledger-validator.mjs',
  'research/chassis/harness/experiment-protocol-validator.mjs',
  'research/chassis/harness/experiment-record-schema-validator.mjs',
  'research/chassis/harness/experiment-record-validator.mjs',
  'research/chassis/harness/external-oracle.mjs',
  'research/chassis/harness/fault-barrier.mjs',
  'research/chassis/harness/formal-cleanup-support.mjs',
  'research/chassis/harness/formal-dbos-lifecycle.mjs',
  'research/chassis/harness/formal-environment-identity.mjs',
  'research/chassis/harness/formal-executor-support.mjs',
  'research/chassis/harness/formal-lifecycle-promotion-review.mjs',
  'research/chassis/harness/formal-lifecycle-qualification-provenance.mjs',
  'research/chassis/harness/formal-lifecycle-runtime-receipt-validator.mjs',
  'research/chassis/harness/formal-promotion-policy.mjs',
  'research/chassis/harness/formal-runtime-lifecycle.mjs',
  'research/chassis/harness/formal-runtime-lifecycle-router.mjs',
  'research/chassis/harness/formal-single-run.mjs',
  'research/chassis/harness/formal-worker-pid-provenance.mjs',
  'research/chassis/harness/harness-provenance.mjs',
  'research/chassis/harness/repository-provenance.mjs',
  'research/chassis/harness/t5-evaluator.mjs',
  'research/chassis/harness/t5-record-bridge.mjs',
  'research/chassis/harness/t11-cancel-retry-control.mjs',
  'research/chassis/harness/t11-evaluator.mjs',
  'research/chassis/harness/t11-record-bridge.mjs',
  'research/chassis/harness/t11-run-hook.mjs',
  'research/chassis/harness/t12-stale-completion-control.mjs',
  'research/chassis/harness/t12-evaluator.mjs',
  'research/chassis/harness/t12-record-bridge.mjs',
  'research/chassis/harness/t12-run-hook.mjs',
  'research/chassis/harness/t16-semantic-control.mjs',
  'research/chassis/harness/t16-evaluator.mjs',
  'research/chassis/harness/t16-record-bridge.mjs',
  'research/chassis/harness/t16-run-hook.mjs',
  'research/chassis/harness/t16-temporal-run-hook.mjs',
  'research/chassis/adapters/temporal-ts/package-lock.json',
  'research/chassis/adapters/temporal-ts/t5-activities.mjs',
  'research/chassis/adapters/temporal-ts/t5-two-worker-driver.mjs',
  'research/chassis/adapters/temporal-ts/t5-worker-process.mjs',
  'research/chassis/adapters/temporal-ts/t5-workflow.mjs',
  'research/chassis/adapters/temporal-ts/t11-activities.mjs',
  'research/chassis/adapters/temporal-ts/t11-driver.mjs',
  'research/chassis/adapters/temporal-ts/t11-worker-process.mjs',
  'research/chassis/adapters/temporal-ts/t11-workflow.mjs',
  'research/chassis/adapters/temporal-ts/t12-driver.mjs',
  'research/chassis/adapters/temporal-ts/t16-driver.mjs',
  'research/chassis/adapters/temporal-ts/t16-worker-process.mjs',
  'research/chassis/adapters/temporal-ts/t16-workflow-a.mjs',
  'research/chassis/adapters/temporal-ts/t16-workflow-b.mjs',
  'research/chassis/adapters/dbos-ts/package-lock.json',
  'research/chassis/adapters/dbos-ts/t5-two-worker-driver.mjs',
  'research/chassis/adapters/dbos-ts/t5-worker-process.mjs',
  'research/chassis/adapters/dbos-ts/t5-workflow.mjs',
  'research/chassis/adapters/dbos-ts/t11-driver.mjs',
  'research/chassis/adapters/dbos-ts/t11-worker-process.mjs',
  'research/chassis/adapters/dbos-ts/t11-workflow.mjs',
  'research/chassis/adapters/dbos-ts/t12-driver.mjs',
  'research/chassis/adapters/dbos-ts/t16-driver.mjs',
  'research/chassis/adapters/dbos-ts/t16-worker-process.mjs',
  'research/chassis/adapters/dbos-ts/t16-workflow.mjs',
  'research/chassis/adapters/restate-ts/t5-control.mjs',
  'research/chassis/adapters/restate-ts/t5-two-worker-driver.mjs',
  'research/chassis/adapters/restate-ts/t5-service-process.mjs',
  'research/chassis/adapters/restate-ts/t5-workflow.mjs',
  'research/chassis/adapters/restate-ts/t11-driver.mjs',
  'research/chassis/adapters/restate-ts/t11-service-process.mjs',
  'research/chassis/adapters/restate-ts/t11-workflow.mjs',
  'research/chassis/adapters/restate-ts/t12-control.mjs',
  'research/chassis/adapters/restate-ts/t12-driver.mjs',
  'research/chassis/adapters/restate-ts/t12-service-process.mjs',
  'research/chassis/adapters/restate-ts/t12-workflow.mjs',
  'research/chassis/adapters/restate-ts/t16-driver.mjs',
  'research/chassis/adapters/restate-ts/t16-service-process.mjs',
  'research/chassis/adapters/restate-ts/t16-workflow-a.mjs',
  'research/chassis/adapters/restate-ts/t16-workflow-b.mjs',
  'research/chassis/T5-OWNERSHIP-CONTRACT-V1.md',
  'research/chassis/T11-CANCEL-CRASH-RETRY-CONTRACT-V1.md',
  'research/chassis/T12-STALE-COMPLETION-CONTRACT-V1.md',
  'research/chassis/T16-SEMANTIC-COMPATIBILITY-CONTRACT-V1.md',
  'research/chassis/experiment-protocol.v1.json',
  'research/chassis/experiment-record.schema.v1.json',
  'research/chassis/fault-suite.v1.json',
  'research/chassis/adapter-capabilities.v1.json',
  'research/chassis/critical-mutant-plan.v1.json',
  'research/chassis/formal-promotion-policy.v1.json'
]);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function computeHarnessProvenance(repositoryRoot, files = FORMAL_HARNESS_FILES) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  const entries = [];
  for (const relativePath of [...files].sort()) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const content = await readFile(absolutePath);
    entries.push({ path: relativePath, sha256: sha256(content), bytes: content.length });
  }
  const canonical = entries.map((entry) => `${entry.path}\t${entry.sha256}\t${entry.bytes}`).join('\n') + '\n';
  return {
    algorithm: 'sha256',
    canonicalization: 'sorted path<TAB>sha256<TAB>bytes newline',
    files: entries,
    aggregateSha256: sha256(Buffer.from(canonical, 'utf8'))
  };
}

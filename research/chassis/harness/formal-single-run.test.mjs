import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runFormalSingle } from './formal-single-run.mjs';
import { FORMAL_HARNESS_FILES } from './harness-provenance.mjs';

const candidates = ['Temporal TypeScript', 'DBOS TypeScript', 'Restate', 'Trigger.dev'];
const criticalMutants = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16'];

async function writeJson(root, relativePath, value) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function syntheticBlockedRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'naia-formal-single-'));

  const protocol = {
    schemaVersion: 1,
    status: 'SPECIFIED_NOT_EXECUTED',
    decisionState: { benchmarkToBeat: 'NOT_SELECTED', chassisWinner: 'NOT_SELECTED' },
    candidates,
    criticalMutants,
    repetitionPolicy: {
      minimumPerCriticalMutant: 100,
      seedPolicy: {
        requiredWhenRandomized: true,
        candidateOrdinals: { 'Temporal TypeScript': 1, 'DBOS TypeScript': 2, Restate: 3, 'Trigger.dev': 4 },
        mutantOrdinals: { T5: 5, T7: 7, T8: 8, T11: 11, T12: 12, T16: 16 }
      }
    },
    executionOrder: { policy: 'round-robin-by-repetition', sequence: 'synthetic test sequence' }
  };
  const faultSuite = {
    schemaVersion: 1,
    mutants: criticalMutants.map((id) => ({ id, critical: true, minRepetitions: 100 })),
    benchmarkEligibility: { forbidBlockedOrInconclusive: criticalMutants }
  };
  const capabilities = {
    schemaVersion: 1,
    candidates: [{
      candidate: 'Temporal TypeScript',
      version: '1.23.0',
      source_ref: 'temporalio/sdk-typescript v1.23.0',
      execution_package: { '@temporalio/worker': '1.23.0' },
      package_manifest: 'research/chassis/adapters/temporal-ts/package.json',
      adapter: 'research/chassis/adapters/temporal-ts/adapter.mjs',
      mode: 'local-process',
      required_env: [],
      worker_authority_boundary: 'synthetic Temporal worker boundary',
      blocker: 'B001'
    }]
  };

  await writeJson(root, 'research/chassis/experiment-protocol.v1.json', protocol);
  await writeJson(root, 'research/chassis/fault-suite.v1.json', faultSuite);
  await writeJson(root, 'research/chassis/adapter-capabilities.v1.json', capabilities);
  await writeJson(root, 'research/chassis/experiment-record.schema.v1.json', { schemaVersion: 1, synthetic: true });

  for (const relativePath of FORMAL_HARNESS_FILES) {
    if (['research/chassis/experiment-protocol.v1.json', 'research/chassis/fault-suite.v1.json', 'research/chassis/adapter-capabilities.v1.json', 'research/chassis/experiment-record.schema.v1.json'].includes(relativePath)) continue;
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `// synthetic provenance fixture: ${relativePath}\n`);
  }

  await writeJson(root, 'research/chassis/adapters/temporal-ts/package.json', {
    name: 'synthetic-temporal-adapter',
    private: true,
    type: 'module',
    dependencies: { '@temporalio/worker': '1.23.0' }
  });
  const adapter = path.join(root, 'research/chassis/adapters/temporal-ts/adapter.mjs');
  await mkdir(path.dirname(adapter), { recursive: true });
  await writeFile(adapter, '// synthetic adapter; runtime dependency intentionally absent\n');

  return root;
}

test('declared Temporal T7 single-run records missing SDK as valid BLOCKED evidence without executing fault', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));

  const result = await runFormalSingle({
    repositoryRoot,
    candidateName: 'Temporal TypeScript',
    mutantId: 'T7',
    repetition: 1,
    env: {},
    timeoutMs: 1000
  });

  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.experimentId, 'temporal-typescript-t7-001');
  assert.equal(result.record.randomSeed, 1070001);
  assert.equal(result.record.verdict, 'BLOCKED');
  assert.equal(result.record.setup.status, 'BLOCKED_SETUP');
  assert.match(result.record.blocker, /DEPENDENCY_NOT_INSTALLED/);
  assert.match(result.record.setup.harnessSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.record.setup.parameters.harnessProvenanceMode, 'FORMAL_BUNDLE');
  assert.equal(result.record.run.fault.injected, false);
  assert.equal(result.record.cleanup.status, 'NOT_APPLICABLE');
});

test('declared Temporal T5 single-run may reach setup and remain BLOCKED when SDK is missing', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));

  const result = await runFormalSingle({
    repositoryRoot,
    candidateName: 'Temporal TypeScript',
    mutantId: 'T5',
    repetition: 1,
    env: {},
    timeoutMs: 1000
  });

  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.experimentId, 'temporal-typescript-t5-001');
  assert.equal(result.record.randomSeed, 1050001);
  assert.equal(result.record.verdict, 'BLOCKED');
  assert.equal(result.record.run.fault.injected, false);
});

test('formal single-run rejects a critical mutant without a declared executor before record creation', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  await assert.rejects(
    runFormalSingle({ repositoryRoot, candidateName: 'Temporal TypeScript', mutantId: 'T11', repetition: 1, env: {} }),
    /FORMAL_EXECUTOR_NOT_DECLARED_FOR_CANDIDATE:Temporal TypeScript\/T11/
  );
});

test('formal single-run rejects T15 because it is outside the declared formal executor set', async (t) => {
  const repositoryRoot = await syntheticBlockedRepository();
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  await assert.rejects(
    runFormalSingle({ repositoryRoot, candidateName: 'Temporal TypeScript', mutantId: 'T15', repetition: 1, env: {} }),
    /FORMAL_EXECUTOR_NOT_DECLARED_FOR_CANDIDATE:Temporal TypeScript\/T15/
  );
});

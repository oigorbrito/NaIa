import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';

function runNode(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function scheduleEnv(rootDir, overrides = {}) {
  return {
    NAIA_DATA_DIR: rootDir,
    NAIA_SCHEDULE_SECRET: 'external-schedule-secret',
    NAIA_SCHEDULE_AUTOMATION_ID: 'daily-brief',
    NAIA_SCHEDULE_EXPRESSION: '0 8 * * *',
    NAIA_SCHEDULE_TIMEZONE: 'America/Sao_Paulo',
    NAIA_SCHEDULE_INTENT: 'uppercase: scheduled from external process',
    ...overrides,
  };
}

async function persistedText(rootDir) {
  const names = ['objectives.json', 'plans.json', 'evidence.jsonl'];
  const chunks = [];
  for (const name of names) {
    try {
      chunks.push(await readFile(join(rootDir, name), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return chunks.join('\n');
}

test('EXT-SCHED-01 separate scheduler process persists a scheduled objective', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-external-schedule-'));
  try {
    const child = runNode([
      'src/product/schedule-delivery-cli.mjs',
      'occurrence-2026-09-11',
      '2026-09-11T11:00:00.000Z',
    ], scheduleEnv(rootDir));
    assert.equal(child.status, 0, child.stderr);
    const output = JSON.parse(child.stdout);
    assert.equal(output.registration.registrationId, 'local-schedule:daily-brief');
    assert.equal(output.result.objective.status, 'WAITING_CONFIRMATION');

    const service = createNaiaService(createFilePorts({ rootDir }));
    const history = await service.history();
    assert.equal(history.length, 1);
    assert.equal(history[0].id, output.result.objective.id);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('EXT-SCHED-02 replay from another process deduplicates the same occurrence', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-external-schedule-replay-'));
  try {
    const args = ['src/product/schedule-delivery-cli.mjs', 'occurrence-replay', '2026-09-11T11:00:00.000Z'];
    const first = runNode(args, scheduleEnv(rootDir));
    const second = runNode(args, scheduleEnv(rootDir));
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const firstOutput = JSON.parse(first.stdout);
    const secondOutput = JSON.parse(second.stdout);
    assert.equal(secondOutput.result.objective.id, firstOutput.result.objective.id);

    const service = createNaiaService(createFilePorts({ rootDir }));
    assert.equal((await service.history()).length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('EXT-SCHED-03 scheduler secret is runtime-only and absent from persisted state', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-external-schedule-secret-'));
  try {
    const secret = 'never-persist-this-scheduler-secret';
    const child = runNode([
      'src/product/schedule-delivery-cli.mjs',
      'occurrence-secret',
      '2026-09-11T11:00:00.000Z',
    ], scheduleEnv(rootDir, { NAIA_SCHEDULE_SECRET: secret }));
    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(await persistedText(rootDir), new RegExp(secret));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('EXT-SCHED-04 incomplete external scheduler configuration fails before side effects', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-external-schedule-invalid-'));
  try {
    const env = scheduleEnv(rootDir, { NAIA_SCHEDULE_SECRET: '' });
    const child = runNode(['src/product/schedule-delivery-cli.mjs', 'occurrence-invalid'], env);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /schedule secret is required/i);

    const service = createNaiaService(createFilePorts({ rootDir }));
    assert.equal((await service.history()).length, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('EXT-SCHED-05 a later independent process can confirm and complete the persisted objective', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-external-schedule-confirm-'));
  try {
    const delivery = runNode([
      'src/product/schedule-delivery-cli.mjs',
      'occurrence-confirm',
      '2026-09-11T11:00:00.000Z',
    ], scheduleEnv(rootDir));
    assert.equal(delivery.status, 0, delivery.stderr);
    const objectiveId = JSON.parse(delivery.stdout).result.objective.id;

    const confirm = runNode(['src/product/cli.mjs', 'confirm', objectiveId], { NAIA_DATA_DIR: rootDir });
    assert.equal(confirm.status, 0, confirm.stderr);
    assert.equal(JSON.parse(confirm.stdout).objective.status, 'COMPLETED');

    const service = createNaiaService(createFilePorts({ rootDir }));
    assert.equal((await service.history()).length, 1);
    assert.equal((await service.get(objectiveId)).objective.status, 'COMPLETED');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createExternalScheduleDelivery } from './external-schedule.mjs';
import { resolveRuntimeCommit } from './runtime-identity.mjs';

async function writeReceipt(path, receipt) {
  if (!path) return;
  const target = isAbsolute(path) ? path : resolve(process.cwd(), path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

const [occurrenceId, at] = process.argv.slice(2);
if (!occurrenceId) {
  console.error('Usage: node src/product/schedule-delivery-cli.mjs <occurrenceId> [at]');
  process.exitCode = 2;
} else {
  try {
    const runtime = createExternalScheduleDelivery({
      rootDir: process.env.NAIA_DATA_DIR || '.naia',
      secret: process.env.NAIA_SCHEDULE_SECRET,
      automationId: process.env.NAIA_SCHEDULE_AUTOMATION_ID,
      schedule: process.env.NAIA_SCHEDULE_EXPRESSION,
      timezone: process.env.NAIA_SCHEDULE_TIMEZONE || 'UTC',
      intent: process.env.NAIA_SCHEDULE_INTENT,
      env: process.env,
    });
    const result = await runtime.deliver({ occurrenceId, at });
    const receipt = {
      status: 'PASS',
      gate: 'EXTERNAL_SCHEDULER_DELIVERY',
      commit: resolveRuntimeCommit(),
      occurrenceId,
      automationId: runtime.registration.automationId,
      objectiveId: result.objective.id,
      objectiveStatus: result.objective.status,
      observedAt: new Date().toISOString(),
    };
    await writeReceipt(String(process.env.NAIA_SCHEDULE_RECEIPT ?? '').trim(), receipt);
    process.stdout.write(`${JSON.stringify({ registration: runtime.registration, result, receipt }, null, 2)}\n`);
  } catch (error) {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 1;
  }
}

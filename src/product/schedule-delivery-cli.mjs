#!/usr/bin/env node
import { createExternalScheduleDelivery } from './external-schedule.mjs';

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
    process.stdout.write(`${JSON.stringify({ registration: runtime.registration, result }, null, 2)}\n`);
  } catch (error) {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 1;
  }
}

import { createFilePorts } from './file-ports.mjs';
import { createRuntimeComposition } from './runtime-config.mjs';
import { createNaiaService } from './service.mjs';
import { createTriggerRuntime } from './trigger-runtime.mjs';
import { createScheduleRuntime } from './schedule-runtime.mjs';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function createExternalScheduleDelivery({
  rootDir = '.naia',
  secret,
  automationId,
  schedule,
  timezone = 'UTC',
  intent,
  env = process.env,
} = {}) {
  const triggerSecret = required(secret, 'schedule secret');
  const id = required(automationId, 'schedule automationId');
  const scheduleText = required(schedule, 'schedule expression');
  const objectiveIntent = required(intent, 'schedule intent');
  const zone = required(timezone, 'schedule timezone');

  const runtime = createRuntimeComposition({ env });
  const ports = createFilePorts({
    rootDir,
    capabilities: runtime.capabilities,
    executionAdapters: runtime.executionAdapters,
  });
  const service = createNaiaService(ports);
  const triggerRuntime = createTriggerRuntime({
    service,
    secret: triggerSecret,
    automation: {
      id,
      enabled: true,
      eventType: 'schedule.occurrence',
      intent: () => objectiveIntent,
    },
  });
  const scheduler = createScheduleRuntime({
    triggerRuntime,
    secret: triggerSecret,
    automationId: id,
    schedule: scheduleText,
    timezone: zone,
  });

  return {
    registration: scheduler.registration,
    service,
    ports,
    async deliver({ occurrenceId, at } = {}) {
      return scheduler.tick({ occurrenceId, at });
    },
  };
}

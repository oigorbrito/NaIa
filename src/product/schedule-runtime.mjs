import { signTriggerDelivery } from './trigger-runtime.mjs';

export function createScheduleRuntime({ triggerRuntime, secret, automationId, schedule, timezone = 'UTC' }) {
  if (!triggerRuntime?.receive) throw new Error('schedule runtime requires a trigger runtime');
  if (!secret || !automationId || !schedule) throw new Error('schedule registration is incomplete');
  const registration = { automationId, schedule, timezone, registrationId: `local-schedule:${automationId}` };

  return {
    registration,
    async tick({ occurrenceId, at }) {
      if (!occurrenceId) throw new Error('occurrence id is required');
      const payload = { occurrenceId, at: at ?? new Date().toISOString() };
      return triggerRuntime.receive({
        rawBody: JSON.stringify(payload),
        signature: signTriggerDelivery(secret, payload),
        deliveryId: occurrenceId,
        eventType: 'schedule.occurrence',
      });
    },
  };
}

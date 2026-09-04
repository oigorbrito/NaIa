import { AutomationTriggerKind } from './automations.mjs';

function clone(value) { return value == null ? value : structuredClone(value); }

export function createScheduleSource({ naia, runtime, clock = () => new Date() } = {}) {
  if (!naia?.automations) throw new Error('naia automations service is required');
  if (!runtime?.dispatch) throw new Error('trigger runtime dispatch is required');

  return {
    async emitOccurrence({ automationId, scheduledFor = clock().toISOString(), parameters = {} } = {}) {
      const automation = await naia.automation(automationId);
      if (!automation) throw new Error(`automation not found: ${automationId}`);
      if (!automation.enabled) throw new Error(`automation is disabled: ${automationId}`);
      if (automation.trigger?.kind !== AutomationTriggerKind.SCHEDULE) throw new Error(`automation is not schedule-triggered: ${automationId}`);
      const occurrence = String(scheduledFor ?? '').trim();
      if (!occurrence) throw new Error('scheduledFor is required');
      return runtime.dispatch({
        automationId,
        trigger: { kind: AutomationTriggerKind.SCHEDULE, scheduledFor: occurrence },
        scheduledFor: occurrence,
        parameters: clone(parameters),
        source: 'schedule-source',
        idempotencyKey: `schedule:${automationId}:${occurrence}`,
      });
    },

    async emitDue({ scheduledFor = clock().toISOString(), automationIds = null, parametersByAutomation = {} } = {}) {
      const occurrence = String(scheduledFor ?? '').trim();
      if (!occurrence) throw new Error('scheduledFor is required');
      const selected = automationIds ? new Set(automationIds.map(String)) : null;
      const automations = await naia.automations();
      const candidates = automations.filter((automation) => automation.enabled && automation.trigger?.kind === AutomationTriggerKind.SCHEDULE && (!selected || selected.has(automation.id)));
      const deliveries = [];
      for (const automation of candidates) {
        deliveries.push(await this.emitOccurrence({ automationId: automation.id, scheduledFor: occurrence, parameters: parametersByAutomation[automation.id] ?? {} }));
      }
      return deliveries;
    },
  };
}

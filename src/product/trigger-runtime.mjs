import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(secret, rawBody) {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function authenticate(secret, rawBody, supplied) {
  if (typeof supplied !== 'string') return false;
  const expected = Buffer.from(signature(secret, rawBody));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signTriggerDelivery(secret, payload) {
  return signature(secret, typeof payload === 'string' ? payload : JSON.stringify(payload));
}

export function createTriggerRuntime({ service, secret, automation }) {
  if (!service?.pursue) throw new Error('trigger runtime requires a service');
  if (!secret) throw new Error('trigger runtime secret is required');

  return {
    async receive({ rawBody, signature: suppliedSignature, deliveryId, eventType }) {
      const body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
      if (!authenticate(secret, body, suppliedSignature)) {
        const error = new Error('invalid trigger authentication');
        error.code = 'INVALID_TRIGGER_AUTH';
        throw error;
      }
      if (!automation?.enabled) {
        const error = new Error('automation is disabled');
        error.code = 'AUTOMATION_DISABLED';
        throw error;
      }
      if (automation.eventType !== eventType) {
        const error = new Error('trigger event mismatch');
        error.code = 'TRIGGER_MISMATCH';
        throw error;
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        const error = new Error('malformed trigger delivery');
        error.code = 'MALFORMED_DELIVERY';
        throw error;
      }
      if (!deliveryId) throw new Error('delivery id is required');
      const result = await service.pursue({
        title: automation.intent(payload),
        idempotencyKey: `${automation.id}:${deliveryId}`,
        deferConfirmation: true,
      });
      await service.recordEvidence?.({
        type: 'TRIGGER_RECEIVED',
        objectiveId: result.objective.id,
        deliveryId,
        automationId: automation.id,
        payload,
      });
      return { deliveryId, automationId: automation.id, ...result };
    },
  };
}

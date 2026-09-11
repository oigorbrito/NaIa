import http from 'node:http';
import { createTriggerRuntime } from './trigger-runtime.mjs';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`webhook body exceeds maxBytes (${maxBytes})`);
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function createGitHubWebhookServer({
  service,
  secret,
  automationId,
  eventType,
  intent,
  host = '127.0.0.1',
  port = 0,
  path = '/webhook/github',
  maxBytes = 256 * 1024,
  onAccepted = null,
} = {}) {
  if (!service?.pursue) throw new Error('GitHub webhook server requires NaIA service');
  const webhookSecret = required(secret, 'GitHub webhook secret');
  const id = required(automationId, 'GitHub webhook automationId');
  const expectedEvent = required(eventType, 'GitHub webhook eventType');
  const staticIntent = required(intent, 'GitHub webhook intent');
  const listenHost = required(host, 'GitHub webhook host');
  const route = required(path, 'GitHub webhook path');
  if (!route.startsWith('/')) throw new Error('GitHub webhook path must start with /');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('GitHub webhook port must be 0..65535');
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('GitHub webhook maxBytes must be positive');
  if (onAccepted !== null && typeof onAccepted !== 'function') throw new Error('GitHub webhook onAccepted must be a function');

  const trigger = createTriggerRuntime({
    service,
    secret: webhookSecret,
    automation: {
      id,
      enabled: true,
      eventType: expectedEvent,
      intent: () => staticIntent,
    },
  });

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== route) {
      writeJson(res, 404, { ok: false, error: 'not found' });
      return;
    }

    try {
      const rawBody = await readBody(req, maxBytes);
      const signature = req.headers['x-hub-signature-256'];
      const deliveryId = req.headers['x-github-delivery'];
      const suppliedEvent = req.headers['x-github-event'];
      const result = await trigger.receive({
        rawBody,
        signature,
        deliveryId,
        eventType: suppliedEvent,
      });
      const accepted = {
        deliveryId: result.deliveryId,
        automationId: result.automationId,
        objectiveId: result.objective.id,
        status: result.objective.status,
        eventType: suppliedEvent,
      };
      if (onAccepted) await onAccepted(accepted);
      writeJson(res, 202, { ok: true, ...accepted });
    } catch (error) {
      const status = error?.code === 'INVALID_TRIGGER_AUTH' ? 401
        : error?.code === 'TRIGGER_MISMATCH' ? 422
          : error?.code === 'MALFORMED_DELIVERY' ? 400
            : error?.code === 'BODY_TOO_LARGE' ? 413
              : 400;
      writeJson(res, status, { ok: false, error: error?.code ?? 'WEBHOOK_REJECTED' });
    }
  });

  return {
    server,
    async start() {
      if (server.listening) return server.address();
      server.listen(port, listenHost);
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      return server.address();
    },
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

import { createServer } from 'node:http';
import { createProviderWebhookIngress } from './provider-webhooks.mjs';

async function readBody(request, limitBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('webhook request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createProviderWebhookHttpServer({ runtime, adapters = {}, authenticators = {}, host = '127.0.0.1', port = 8788, limitBytes = 1024 * 1024 } = {}) {
  if (!runtime?.dispatch) throw new Error('trigger runtime dispatch is required');
  let server;
  return {
    async start() {
      if (server) return server.address();
      server = createServer(async (request, response) => {
        const match = String(request.url ?? '').match(/^\/webhooks\/([^/]+)\/([^/?#]+)$/);
        if (!match) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'not-found' }));
          return;
        }
        const [, provider, automationId] = match;
        const adapter = adapters[provider];
        if (!adapter) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'provider-not-configured', provider }));
          return;
        }
        try {
          const rawBody = await readBody(request, limitBytes);
          const body = rawBody ? JSON.parse(rawBody) : {};
          const ingress = createProviderWebhookIngress({ runtime, adapter, automationId, authenticator: authenticators[provider] });
          const result = await ingress.handle({ method: request.method, headers: request.headers, rawBody, body });
          response.writeHead(result.status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(result.body));
        } catch (error) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'bad-request', message: error?.message ?? String(error), provider }));
        }
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async stop() {
      if (!server) return;
      const current = server;
      server = null;
      await new Promise((resolve, reject) => current.close((error) => error ? reject(error) : resolve()));
    },
  };
}

import { createServer } from 'node:http';

async function readBody(request, limitBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('trigger request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createTriggerHttpServer({ ingress, host = '127.0.0.1', port = 8787, path = '/triggers' } = {}) {
  if (!ingress?.handle) throw new Error('trigger ingress handler is required');
  let server;
  return {
    async start() {
      if (server) return server.address();
      server = createServer(async (request, response) => {
        if (request.url !== path) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'not-found' }));
          return;
        }
        try {
          const rawBody = await readBody(request);
          let body = {};
          if (rawBody) body = JSON.parse(rawBody);
          const result = await ingress.handle({ method: request.method, headers: request.headers, rawBody, body });
          response.writeHead(result.status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(result.body));
        } catch (error) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'bad-request', message: error?.message ?? String(error) }));
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

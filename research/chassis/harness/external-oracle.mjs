import http from 'node:http';

export function createExternalEffectOracle() {
  const operations = new Map();
  let server;

  function snapshot(operationId) {
    const entry = operations.get(operationId);
    if (!entry) return null;
    return structuredClone(entry);
  }

  async function start() {
    if (server) throw new Error('oracle already started');

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      if (req.method === 'POST' && url.pathname === '/apply') {
        const operationId = req.headers['x-operation-id'];
        if (typeof operationId !== 'string' || operationId.length === 0) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'x-operation-id required' }));
          return;
        }

        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('utf8');

        let entry = operations.get(operationId);
        if (!entry) {
          entry = {
            operationId,
            requestCount: 0,
            applyCount: 0,
            firstAppliedAt: null,
            lastRequestAt: null,
            payload: null
          };
          operations.set(operationId, entry);
        }

        entry.requestCount += 1;
        entry.lastRequestAt = new Date().toISOString();

        if (entry.applyCount === 0) {
          entry.applyCount = 1;
          entry.firstAppliedAt = new Date().toISOString();
          entry.payload = body;
        }

        if (req.headers['x-drop-response-after-apply'] === '1') {
          req.socket.destroy();
          return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(snapshot(operationId)));
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/operations/')) {
        const operationId = decodeURIComponent(url.pathname.slice('/operations/'.length));
        const entry = snapshot(operationId);
        if (!entry) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(entry));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/reset') {
        operations.clear();
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
  }

  async function stop() {
    if (!server) return;
    const current = server;
    server = undefined;
    await new Promise((resolve, reject) => current.close((err) => err ? reject(err) : resolve()));
  }

  return { start, stop, snapshot };
}

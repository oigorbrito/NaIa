import { createServer } from 'node:http';
import { createFilePorts } from './src/product/file-ports.mjs';
import { createNaiaService } from './src/product/service.mjs';
import { createTaskService, createFileTaskStore, registerTaskCapabilities } from './src/product/tasks.mjs';
import { createEntitlementService } from './src/product/entitlements.mjs';
import { createUsageMeter } from './src/product/metering.mjs';
import { createFileBillStore, createBillService } from './src/product/bills.mjs';
import { createFileHistoryStore, createHistoryService } from './src/product/history.mjs';
import { createFrontendApi } from './src/product/frontend-api.mjs';
import { createProductionWebUi } from './src/product/production-web-ui.mjs';

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const dataDir = process.env.NAIA_DATA_DIR || '.naia';
const userId = process.env.NAIA_USER_ID || 'default-user';

const ports = createFilePorts({ rootDir: dataDir });
const naia = createNaiaService(ports, { userId });
const taskStore = createFileTaskStore({ rootDir: dataDir });
const tasks = createTaskService({ store: taskStore });

try {
  registerTaskCapabilities(naia, { service: tasks, userId });
} catch (e) {
  console.warn('Task capabilities registration note:', e.message);
}

const entitlements = createEntitlementService();
const meter = createUsageMeter({ entitlements });
const billStore = createFileBillStore({ rootDir: dataDir });
const bills = createBillService({ store: billStore, taskService: tasks });
const historyStore = createFileHistoryStore({ rootDir: dataDir });
const historyIndex = createHistoryService({ store: historyStore, entitlements });

const connectors = {
  async list({ userId: uid } = {}) {
    return [
      { id: 'google-workspace', provider: 'google', state: 'AVAILABLE' },
      { id: 'belvo-finance', provider: 'belvo', state: 'AVAILABLE' },
    ];
  },
};

const media = {
  async list({ userId: uid } = {}) {
    return [];
  },
};

const api = createFrontendApi({
  naia,
  userId,
  tasks,
  entitlements,
  meter,
  connectors,
  historyIndex,
  bills,
  media,
});

// Auto-index objectives into history index
const originalSubmit = api.submit.bind(api);
api.submit = async (params) => {
  const result = await originalSubmit(params);
  if (result.ok && result.objective) {
    try {
      const snapshot = await naia.get(result.objective.id);
      await historyIndex.ingestObjective({ userId, snapshot });
    } catch (e) {
      console.warn('History ingest error:', e.message);
    }
  }
  return result;
};

try {
  const existing = await ports.objectives.list();
  for (const obj of existing) {
    const snapshot = await naia.get(obj.id);
    if (snapshot?.objective) {
      await historyIndex.ingestObjective({ userId, snapshot });
    }
  }
} catch (e) {
  // Non-fatal startup sync
}

const ui = createProductionWebUi({ api });

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    // Health check endpoint
    if (pathname === '/health' || pathname === '/_health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
      return;
    }

    // Collect request body for POST/PUT/PATCH
    let body = '';
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      for await (const chunk of req) {
        body += chunk;
      }
    }

    const response = await ui.handle({
      method,
      path: pathname,
      body,
    });

    res.writeHead(response.status, response.headers);
    res.end(response.body);
  } catch (error) {
    console.error('Unhandled server error:', error);
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>Internal Server Error</h1><pre>${error?.message ?? error}</pre>`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NaIA Web Server running at http://${HOST}:${PORT}`);
});

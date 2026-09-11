#!/usr/bin/env node
import { createFilePorts } from './file-ports.mjs';
import { createRuntimeComposition } from './runtime-config.mjs';
import { createNaiaService } from './service.mjs';
import { createGitHubWebhookServer } from './github-webhook-server.mjs';

function integer(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

try {
  const runtime = createRuntimeComposition({ env: process.env });
  const ports = createFilePorts({
    rootDir: process.env.NAIA_DATA_DIR || '.naia',
    capabilities: runtime.capabilities,
    executionAdapters: runtime.executionAdapters,
  });
  const service = createNaiaService(ports);
  const webhook = createGitHubWebhookServer({
    service,
    secret: process.env.NAIA_GITHUB_WEBHOOK_SECRET,
    automationId: process.env.NAIA_GITHUB_WEBHOOK_AUTOMATION_ID,
    eventType: process.env.NAIA_GITHUB_WEBHOOK_EVENT,
    intent: process.env.NAIA_GITHUB_WEBHOOK_INTENT,
    host: process.env.NAIA_GITHUB_WEBHOOK_HOST || '127.0.0.1',
    port: integer(process.env.NAIA_GITHUB_WEBHOOK_PORT, 8788, 'NAIA_GITHUB_WEBHOOK_PORT'),
    path: process.env.NAIA_GITHUB_WEBHOOK_PATH || '/webhook/github',
    maxBytes: integer(process.env.NAIA_GITHUB_WEBHOOK_MAX_BYTES, 256 * 1024, 'NAIA_GITHUB_WEBHOOK_MAX_BYTES'),
  });
  const address = await webhook.start();
  process.stdout.write(`${JSON.stringify({
    status: 'LISTENING',
    host: address.address,
    port: address.port,
    path: process.env.NAIA_GITHUB_WEBHOOK_PATH || '/webhook/github',
  })}\n`);

  const shutdown = async () => {
    await webhook.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
}

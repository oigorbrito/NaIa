import { createDefaultCapabilityRegistry } from './capabilities.mjs';
import { createHttpReadAdapter, createHttpReadCapability } from './http-read.mjs';

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function createRuntimeComposition({ env = process.env } = {}) {
  const capabilities = createDefaultCapabilityRegistry();
  const executionAdapters = [];

  const baseUrl = String(env.NAIA_HTTP_BASE_URL ?? '').trim();
  if (!baseUrl) return { capabilities, executionAdapters };

  const prefix = String(env.NAIA_HTTP_PREFIX ?? 'provider-read').trim();
  const tool = String(env.NAIA_HTTP_TOOL ?? 'http.read').trim();
  const timeoutMs = positiveInteger(env.NAIA_HTTP_TIMEOUT_MS, 5000, 'NAIA_HTTP_TIMEOUT_MS');
  const maxBytes = positiveInteger(env.NAIA_HTTP_MAX_BYTES, 256 * 1024, 'NAIA_HTTP_MAX_BYTES');

  capabilities.register(createHttpReadCapability({ id: tool, prefix, tool }));
  executionAdapters.push(createHttpReadAdapter({ baseUrl, tool, timeoutMs, maxBytes }));

  return { capabilities, executionAdapters };
}

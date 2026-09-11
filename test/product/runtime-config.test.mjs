import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeComposition } from '../../src/product/runtime-config.mjs';

test('EXT-CONFIG-01 HTTP provider remains disabled by default', () => {
  const runtime = createRuntimeComposition({ env: {} });
  assert.equal(runtime.executionAdapters.length, 0);
  assert.equal(runtime.capabilities.resolve('provider-read /profile'), null);
});

test('EXT-CONFIG-02 environment enables configured HTTP provider capability and adapter', () => {
  const runtime = createRuntimeComposition({
    env: {
      NAIA_HTTP_BASE_URL: 'https://example.com',
      NAIA_HTTP_PREFIX: 'calendar-read',
      NAIA_HTTP_TOOL: 'calendar.http.read',
      NAIA_HTTP_TIMEOUT_MS: '1200',
      NAIA_HTTP_MAX_BYTES: '4096',
    },
  });

  const resolved = runtime.capabilities.resolve('calendar-read /events');
  assert.equal(resolved.capabilityId, 'calendar.http.read');
  assert.equal(resolved.action.tool, 'calendar.http.read');
  assert.deepEqual(resolved.action.input, { path: '/events' });
  assert.equal(runtime.executionAdapters.length, 1);
  assert.equal(runtime.executionAdapters[0].supports('calendar.http.read'), true);
  assert.equal(runtime.executionAdapters[0].supports('http.read'), false);
});

test('EXT-CONFIG-03 invalid numeric provider configuration fails closed at startup', () => {
  assert.throws(
    () => createRuntimeComposition({ env: { NAIA_HTTP_BASE_URL: 'https://example.com', NAIA_HTTP_TIMEOUT_MS: '0' } }),
    /NAIA_HTTP_TIMEOUT_MS must be a positive integer/,
  );
  assert.throws(
    () => createRuntimeComposition({ env: { NAIA_HTTP_BASE_URL: 'https://example.com', NAIA_HTTP_MAX_BYTES: 'many' } }),
    /NAIA_HTTP_MAX_BYTES must be a positive integer/,
  );
});

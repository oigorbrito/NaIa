import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.env.NAIA_OPENMANUS_ROOT;
const maybeLive = (name, fn) => test(name, { skip: !root && 'NAIA_OPENMANUS_ROOT is not configured' }, fn);

const read = (relative) => readFile(join(root, ...relative.split('/')), 'utf8');

maybeLive('VAL-01 OpenManus exposes Browser Use MCP transport', async () => {
  const source = await read('app/agent/manus.py');
  assert.match(source, /browser-use/);
  assert.match(source, /--cli-mcp/);
  assert.match(source, /connect_mcp_server/);
});

maybeLive('VAL-02 OpenManus exposes concrete GUI computer-use actions', async () => {
  const source = await read('app/tool/computer_use_tool.py');
  for (const action of ['click', 'scroll', 'typing', 'hotkey', 'screenshot']) {
    assert.match(source, new RegExp(`["]${action}["]`));
  }
  assert.match(source, /class ComputerUseTool/);
});

maybeLive('VAL-03 OpenManus exposes shell execution primitive', async () => {
  const source = await read('app/tool/bash.py');
  assert.match(source, /class Bash/);
  assert.match(source, /execute/);
});

maybeLive('VAL-04 OpenManus exposes MCP client tooling', async () => {
  const source = await read('app/tool/mcp.py');
  assert.match(source, /class MCPClients/);
  assert.match(source, /connect_stdio/);
});

maybeLive('VAL-05 OpenManus exposes crawler capability', async () => {
  const source = await read('app/tool/crawl4ai.py');
  assert.match(source, /crawl/i);
  assert.match(source, /ToolResult/);
});

test('VAL-06 NaIA baseline has no native browser/computer-use tool', async () => {
  const source = await readFile(new URL('../../src/product/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /['"]browser\./);
  assert.doesNotMatch(source, /computer[_-]?use/i);
  assert.match(source, /['"]note\.write['"]/);
});

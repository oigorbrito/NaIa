import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { createRuntimeComposition } from '../../src/product/runtime-config.mjs';
import { createNaiaService } from '../../src/product/service.mjs';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function defaultRange() {
  const from = new Date();
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function persistedText(rootDir) {
  const names = ['objectives.json', 'plans.json', 'evidence.jsonl'];
  const chunks = [];
  for (const name of names) {
    try {
      chunks.push(await readFile(join(rootDir, name), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return chunks.join('\n');
}

async function writeReceipt(path, receipt) {
  if (!path) return;
  const target = isAbsolute(path) ? path : resolve(process.cwd(), path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

const token = required(process.env.NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN, 'NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN');
const defaults = defaultRange();
const from = process.env.NAIA_GOOGLE_CALENDAR_LIVE_FROM || defaults.from;
const to = process.env.NAIA_GOOGLE_CALENDAR_LIVE_TO || defaults.to;
const keep = process.env.NAIA_GOOGLE_CALENDAR_LIVE_KEEP === '1';
const receiptPath = String(process.env.NAIA_GOOGLE_CALENDAR_LIVE_RECEIPT ?? '').trim();
const rootDir = await mkdtemp(join(tmpdir(), 'naia-google-calendar-live-'));

try {
  const runtime = createRuntimeComposition({ env: process.env });
  const ports = createFilePorts({
    rootDir,
    capabilities: runtime.capabilities,
    executionAdapters: runtime.executionAdapters,
  });
  const naia = createNaiaService(ports);
  const result = await naia.pursue({ title: `calendar list ${from} | ${to}` });

  if (result.objective.status !== 'COMPLETED') {
    throw new Error(`live Google Calendar objective ended as ${result.objective.status}`);
  }

  const evidence = await ports.evidence.list({ objectiveId: result.objective.id });
  const execution = evidence.find((entry) => entry.type === 'STEP_EXECUTED' && entry.tool === 'calendar.list');
  if (!execution?.ok) throw new Error('live Google Calendar execution evidence missing successful calendar.list');

  const stored = await persistedText(rootDir);
  if (stored.includes(token)) throw new Error('Google Calendar access token leaked into persisted state');

  const events = execution.output?.result ?? [];
  const receipt = {
    status: 'PASS',
    gate: 'LIVE_GCAL_READ',
    objectiveId: result.objective.id,
    from,
    to,
    eventCount: Array.isArray(events) ? events.length : null,
    dataDir: keep ? rootDir : null,
    observedAt: new Date().toISOString(),
  };
  await writeReceipt(receiptPath, receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  if (!keep) await rm(rootDir, { recursive: true, force: true });
}

import { createInterface } from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';

function parseApproval(line) {
  const match = String(line).trim().match(/^approve\s+(\S+)\s+(\S+)$/i);
  return match ? { objectiveId: match[1], capability: match[2] } : null;
}

export async function handleInteractiveLine({ naia, line }) {
  const value = String(line ?? '').trim();
  if (!value) return { kind: 'noop' };
  if (value === '/exit' || value === '/quit') return { kind: 'exit' };
  if (value === '/history') return { kind: 'result', value: await naia.history() };
  if (value === '/tools' || value === '/capabilities') return { kind: 'result', value: naia.tools() };
  if (value.startsWith('/status ')) {
    const id = value.slice('/status '.length).trim();
    return { kind: 'result', value: await naia.status(id) };
  }
  if (value.startsWith('/approve ')) {
    const approval = parseApproval(value.slice(1));
    if (!approval) return { kind: 'message', value: 'Usage: /approve <objectiveId> <capability>' };
    return { kind: 'result', value: await naia.approve(approval.objectiveId, approval.capability) };
  }
  return { kind: 'result', value: await naia.pursue({ title: value }) };
}

export async function runInteractiveSession({ naia, input = defaultInput, output = defaultOutput, prompt = 'naia> ' } = {}) {
  if (!naia) throw new Error('naia service is required');
  const rl = createInterface({ input, output });
  output.write('NaIA interactive session. Commands: /history, /capabilities, /status <id>, /approve <id> <capability>, /exit\n');

  try {
    while (true) {
      const result = await handleInteractiveLine({ naia, line: await rl.question(prompt) });
      if (result.kind === 'noop') continue;
      if (result.kind === 'exit') break;
      if (result.kind === 'message') output.write(`${result.value}\n`);
      if (result.kind === 'result') output.write(`${JSON.stringify(result.value, null, 2)}\n`);
    }
  } finally {
    rl.close();
  }
}

import { createInterface } from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';

function parseApproval(line) {
  const match = String(line).trim().match(/^approve\s+(\S+)\s+(\S+)$/i);
  return match ? { objectiveId: match[1], capability: match[2] } : null;
}

export async function runInteractiveSession({ naia, input = defaultInput, output = defaultOutput, prompt = 'naia> ' } = {}) {
  if (!naia) throw new Error('naia service is required');
  const rl = createInterface({ input, output });
  output.write('NaIA interactive session. Commands: /history, /tools, /status <id>, /approve <id> <capability>, /exit\n');

  try {
    while (true) {
      const line = (await rl.question(prompt)).trim();
      if (!line) continue;
      if (line === '/exit' || line === '/quit') break;
      if (line === '/history') {
        output.write(`${JSON.stringify(await naia.history(), null, 2)}\n`);
        continue;
      }
      if (line === '/tools') {
        output.write(`${JSON.stringify(naia.tools(), null, 2)}\n`);
        continue;
      }
      if (line.startsWith('/status ')) {
        const id = line.slice('/status '.length).trim();
        output.write(`${JSON.stringify(await naia.status(id), null, 2)}\n`);
        continue;
      }
      if (line.startsWith('/approve ')) {
        const approval = parseApproval(line.slice(1));
        if (!approval) {
          output.write('Usage: /approve <objectiveId> <capability>\n');
          continue;
        }
        const result = await naia.approve(approval.objectiveId, approval.capability);
        output.write(`${JSON.stringify(result, null, 2)}\n`);
        continue;
      }

      const result = await naia.pursue({ title: line });
      output.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } finally {
    rl.close();
  }
}

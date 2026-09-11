import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, delimiter } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function createOpenManusExecutionAdapter({
  python = process.env.NAIA_OPENMANUS_PYTHON || 'python',
  openManusRoot = process.env.NAIA_OPENMANUS_ROOT,
  sidecarPath = join(here, 'sidecar.py'),
  timeoutMs = 5_000,
} = {}) {
  if (!openManusRoot) throw new Error('NAIA_OPENMANUS_ROOT is required');

  return {
    async run({ step }) {
      if (!step?.action) return { ok: true, output: { controlStep: step?.kind ?? null } };

      const request = {
        tool: step.action.tool,
        input: step.action.input ?? {},
      };

      return executeSidecar({ python, openManusRoot, sidecarPath, timeoutMs, request });
    },
  };
}

function executeSidecar({ python, openManusRoot, sidecarPath, timeoutMs, request }) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      PYTHONPATH: [openManusRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    };
    const child = spawn(python, [sidecarPath], {
      cwd: openManusRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ ok: false, error: error.message, retryable: true }));
    child.on('close', () => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      if (!last) {
        finish({ ok: false, error: stderr.trim() || 'OpenManus sidecar returned no response', retryable: true });
        return;
      }
      try {
        const response = JSON.parse(last);
        if (response?.ok === true) {
          finish(response);
          return;
        }
        finish({
          ok: false,
          error: response?.error || stderr.trim() || 'OpenManus execution failed',
          retryable: response?.retryable === true,
        });
      } catch {
        finish({ ok: false, error: 'OpenManus sidecar returned invalid JSON', retryable: true });
      }
    });

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: `OpenManus sidecar timed out after ${timeoutMs}ms`, retryable: true });
    }, timeoutMs);

    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

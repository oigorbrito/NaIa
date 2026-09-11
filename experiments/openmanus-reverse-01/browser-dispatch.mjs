import { spawn } from 'node:child_process';

function runBrowserUse(code, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('uvx', ['browser-use'], {
      shell: process.platform === 'win32',
      windowsHide: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, retryable: true, error: `browser-use timed out after ${timeoutMs}ms`, diagnostics: { stdout, stderr } });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, retryable: true, error: error?.message ?? String(error), diagnostics: { stdout, stderr } });
    });
    child.on('close', (codeValue) => {
      clearTimeout(timer);
      if (settled) return;
      if (codeValue === 0) {
        finish({ ok: true, output: { stdout, stderr } });
      } else {
        finish({ ok: false, retryable: true, error: `browser-use exited with code ${codeValue}`, diagnostics: { stdout, stderr } });
      }
    });

    child.stdin.end(code);
  });
}

export function createBrowserUseDispatch({ timeoutMs = 60000 } = {}) {
  return async ({ step }) => {
    const tool = step?.action?.tool;
    const input = step?.action?.input ?? {};

    if (tool !== 'browser.extract') {
      return { ok: false, retryable: false, error: `live dispatcher only supports browser.extract, received: ${tool}` };
    }

    const url = String(input.url ?? '');
    if (!/^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(url)) {
      return { ok: false, retryable: false, error: 'live probe only permits loopback http URLs' };
    }

    const code = [
      `new_tab(${JSON.stringify(url)})`,
      'wait_for_load()',
      'print("NAIA_TITLE=" + str(js("document.title")))',
    ].join('\n');

    const result = await runBrowserUse(code, { timeoutMs });
    if (!result.ok) return result;

    const match = result.output.stdout.match(/NAIA_TITLE=([^\r\n]+)/);
    if (!match) {
      return {
        ok: false,
        retryable: false,
        error: 'browser-use completed without NAIA_TITLE marker',
        diagnostics: result.output,
      };
    }

    return {
      ok: true,
      output: {
        tool,
        title: match[1].trim(),
      },
    };
  };
}

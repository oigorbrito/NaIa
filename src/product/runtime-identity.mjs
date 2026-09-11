import { execFileSync } from 'node:child_process';

export function resolveRuntimeCommit({ env = process.env, cwd = process.cwd() } = {}) {
  const explicit = String(env.NAIA_COMMIT_SHA ?? '').trim();
  if (explicit) return explicit;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

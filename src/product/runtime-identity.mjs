import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPOSITORY_LOCATION_ENV = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
]);

function isolatedGitEnv(env) {
  const merged = { ...process.env, ...env };
  for (const key of Object.keys(merged)) {
    if (REPOSITORY_LOCATION_ENV.has(key.toUpperCase())) delete merged[key];
  }
  return merged;
}

function isExplicitRepositoryRoot(cwd) {
  return existsSync(join(resolve(cwd), '.git'));
}

export function resolveRuntimeCommit({ env = process.env, cwd = process.cwd() } = {}) {
  const explicit = String(env.NAIA_COMMIT_SHA ?? '').trim();
  if (explicit) return explicit;
  if (!isExplicitRepositoryRoot(cwd)) return null;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      env: isolatedGitEnv(env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

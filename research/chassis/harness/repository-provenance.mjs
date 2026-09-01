import { spawn } from 'node:child_process';

function gitRevision(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.trim());
}

async function defaultRunGit(args, { cwd }) {
  const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let spawnError = null;
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => { stdout += chunk; });
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  const result = await new Promise((resolve) => {
    child.once('error', (error) => {
      spawnError = error;
      resolve({ code: null, signal: null });
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    ...result,
    stdout,
    stderr,
    spawnError: spawnError ? String(spawnError) : null
  };
}

export function repositoryProvenanceStructurallyValid(value) {
  if (!value || value.source !== 'git') return false;
  if (!['VERIFIED', 'UNVERIFIED'].includes(value.status)) return false;
  if (value.status === 'VERIFIED') {
    return gitRevision(value.revision) && value.trackedWorktreeClean === true && value.reason === null;
  }
  return (value.revision === null || gitRevision(value.revision))
    && (value.trackedWorktreeClean === null || typeof value.trackedWorktreeClean === 'boolean')
    && typeof value.reason === 'string'
    && value.reason.length > 0;
}

export function repositoryProvenanceReady(value) {
  return repositoryProvenanceStructurallyValid(value) && value.status === 'VERIFIED';
}

export async function inspectRepositoryProvenance(repositoryRoot, { runGit = defaultRunGit } = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');

  let revisionResult;
  try {
    revisionResult = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: repositoryRoot });
  } catch (error) {
    return {
      source: 'git',
      status: 'UNVERIFIED',
      revision: null,
      trackedWorktreeClean: null,
      reason: 'GIT_REVISION_QUERY_ERROR',
      diagnostics: { error: String(error) }
    };
  }

  const revision = String(revisionResult?.stdout ?? '').trim();
  if (revisionResult?.code !== 0 || revisionResult?.spawnError || !gitRevision(revision)) {
    return {
      source: 'git',
      status: 'UNVERIFIED',
      revision: gitRevision(revision) ? revision : null,
      trackedWorktreeClean: null,
      reason: revisionResult?.spawnError ? 'GIT_UNAVAILABLE' : 'GIT_REVISION_UNVERIFIED',
      diagnostics: { revisionResult }
    };
  }

  let statusResult;
  try {
    statusResult = await runGit(['status', '--porcelain=v1', '--untracked-files=no'], { cwd: repositoryRoot });
  } catch (error) {
    return {
      source: 'git',
      status: 'UNVERIFIED',
      revision,
      trackedWorktreeClean: null,
      reason: 'GIT_TRACKED_STATUS_QUERY_ERROR',
      diagnostics: { error: String(error) }
    };
  }

  if (statusResult?.code !== 0 || statusResult?.spawnError) {
    return {
      source: 'git',
      status: 'UNVERIFIED',
      revision,
      trackedWorktreeClean: null,
      reason: statusResult?.spawnError ? 'GIT_UNAVAILABLE' : 'GIT_TRACKED_STATUS_UNVERIFIED',
      diagnostics: { statusResult }
    };
  }

  const trackedWorktreeClean = String(statusResult.stdout ?? '').trim().length === 0;
  return {
    source: 'git',
    status: trackedWorktreeClean ? 'VERIFIED' : 'UNVERIFIED',
    revision,
    trackedWorktreeClean,
    reason: trackedWorktreeClean ? null : 'TRACKED_WORKTREE_DIRTY',
    diagnostics: trackedWorktreeClean ? null : { statusOutput: String(statusResult.stdout ?? '') }
  };
}

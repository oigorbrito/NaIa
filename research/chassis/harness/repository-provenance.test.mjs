import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectRepositoryProvenance,
  repositoryProvenanceReady,
  repositoryProvenanceStructurallyValid
} from './repository-provenance.mjs';

const REVISION = 'a'.repeat(40);

function result(code, stdout = '', stderr = '', spawnError = null) {
  return { code, signal: null, stdout, stderr, spawnError };
}

function fakeGit(sequence) {
  let index = 0;
  return async () => sequence[index++];
}

test('clean tracked Git revision is VERIFIED and reproducibly anchored', async () => {
  const value = await inspectRepositoryProvenance('/fixture', {
    runGit: fakeGit([
      result(0, `${REVISION}\n`),
      result(0, '')
    ])
  });
  assert.equal(value.status, 'VERIFIED');
  assert.equal(value.revision, REVISION);
  assert.equal(value.trackedWorktreeClean, true);
  assert.equal(value.reason, null);
  assert.equal(repositoryProvenanceStructurallyValid(value), true);
  assert.equal(repositoryProvenanceReady(value), true);
});

test('tracked modification makes formal repository provenance UNVERIFIED', async () => {
  const value = await inspectRepositoryProvenance('/fixture', {
    runGit: fakeGit([
      result(0, `${REVISION}\n`),
      result(0, ' M research/chassis/harness/example.mjs\n')
    ])
  });
  assert.equal(value.status, 'UNVERIFIED');
  assert.equal(value.revision, REVISION);
  assert.equal(value.trackedWorktreeClean, false);
  assert.equal(value.reason, 'TRACKED_WORKTREE_DIRTY');
  assert.equal(repositoryProvenanceStructurallyValid(value), true);
  assert.equal(repositoryProvenanceReady(value), false);
});

test('unavailable Git is an infrastructure/provenance blocker rather than candidate failure', async () => {
  const value = await inspectRepositoryProvenance('/fixture', {
    runGit: fakeGit([result(null, '', '', 'Error: spawn git ENOENT')])
  });
  assert.equal(value.status, 'UNVERIFIED');
  assert.equal(value.revision, null);
  assert.equal(value.reason, 'GIT_UNAVAILABLE');
  assert.equal(repositoryProvenanceStructurallyValid(value), true);
  assert.equal(repositoryProvenanceReady(value), false);
});

test('non-repository or malformed revision cannot be reported VERIFIED', async () => {
  const value = await inspectRepositoryProvenance('/fixture', {
    runGit: fakeGit([result(128, 'not-a-revision\n', 'fatal: not a git repository')])
  });
  assert.equal(value.status, 'UNVERIFIED');
  assert.equal(value.revision, null);
  assert.equal(value.reason, 'GIT_REVISION_UNVERIFIED');
  assert.equal(repositoryProvenanceStructurallyValid(value), true);
});

test('structural validator rejects fabricated VERIFIED state with invalid revision or dirty tree', () => {
  assert.equal(repositoryProvenanceStructurallyValid({
    source: 'git', status: 'VERIFIED', revision: 'bad', trackedWorktreeClean: true, reason: null
  }), false);
  assert.equal(repositoryProvenanceStructurallyValid({
    source: 'git', status: 'VERIFIED', revision: REVISION, trackedWorktreeClean: false, reason: null
  }), false);
});

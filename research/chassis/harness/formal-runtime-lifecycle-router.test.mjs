import assert from 'node:assert/strict';
import test from 'node:test';
import { createFormalRuntimeLifecycle } from './formal-runtime-lifecycle-router.mjs';

test('formal lifecycle router returns the Restate implementation without falling through to Temporal', () => {
  const lifecycle = createFormalRuntimeLifecycle({
    candidateName: 'Restate',
    repositoryRoot: '/fixture',
    env: {},
    operations: {}
  });
  assert.equal(lifecycle.candidateName, 'Restate');
  assert.equal(lifecycle.status, 'IMPLEMENTED_NOT_RUNTIME_VERIFIED');
  assert.ok(lifecycle.declaredEnvNames.includes('NAIA_RESTATE_SERVER'));
});

test('formal lifecycle router preserves explicit DBOS and Temporal implementations', () => {
  const dbos = createFormalRuntimeLifecycle({
    candidateName: 'DBOS TypeScript',
    repositoryRoot: '/fixture',
    env: {},
    operations: {}
  });
  const temporal = createFormalRuntimeLifecycle({
    candidateName: 'Temporal TypeScript',
    repositoryRoot: '/fixture',
    env: {},
    operations: {}
  });
  assert.equal(dbos.candidateName, 'DBOS TypeScript');
  assert.equal(temporal.candidateName, 'Temporal TypeScript');
});

test('formal lifecycle router does not fabricate a lifecycle for Trigger.dev', () => {
  const lifecycle = createFormalRuntimeLifecycle({
    candidateName: 'Trigger.dev',
    repositoryRoot: '/fixture',
    env: {},
    operations: {}
  });
  assert.equal(lifecycle, null);
});

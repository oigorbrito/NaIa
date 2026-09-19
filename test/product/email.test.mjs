import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmailService, createFixtureEmailProvider, createMemoryEmailStore, registerEmailCapabilities } from '../../src/product/email.mjs';

function fixture() {
  const store = createMemoryEmailStore();
  let id = 0;
  const service = createEmailService({ store, idFactory: () => 'draft-' + ++id, now: () => '2026-09-19T12:00:00.000Z' });
  const provider = createFixtureEmailProvider({
    token: 'do-not-persist-me',
    messages: [
      { id: 'm1', from: 'a@example.com', to: 'u@example.com', subject: 'Invoice', body: 'Please see attached invoice', date: '2026-09-18T10:00:00Z' },
      { id: 'm2', from: 'b@example.com', to: 'u@example.com', subject: 'Project', body: 'Roadmap update', date: '2026-09-18T11:00:00Z' },
    ],
  });
  return { store, service, provider };
}

test('search and read return provider-backed messages without persisting provider token', async () => {
  const { service, provider } = fixture();
  const search = await service.search({ provider, query: 'invoice' });
  assert.equal(search.messages.length, 1);
  const read = await service.read({ provider, messageId: 'm1' });
  assert.equal(read.message.body, 'Please see attached invoice');
  assert.equal(JSON.stringify(search).includes('do-not-persist-me'), false);
  assert.equal(JSON.stringify(read).includes('do-not-persist-me'), false);
});

test('draft creation is local and does not send externally', async () => {
  const { service, provider } = fixture();
  const draft = await service.draft({ to: 'x@example.com', subject: 'Hello', body: 'Draft body' });
  assert.equal(draft.to, 'x@example.com');
  assert.equal(provider.sent().length, 0);
});

test('send from draft is idempotent by concrete send key', async () => {
  const { service, provider } = fixture();
  const draft = await service.draft({ to: 'x@example.com', subject: 'Hello', body: 'Body' });
  const first = await service.send({ provider, draftId: draft.id, idempotencyKey: 'send-1' });
  const duplicate = await service.send({ provider, draftId: draft.id, idempotencyKey: 'send-1' });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(provider.sent().length, 1);
});

test('provider send failure preserves retryability and does not record false success', async () => {
  const store = createMemoryEmailStore();
  const service = createEmailService({ store });
  const provider = createFixtureEmailProvider({ failSend: { code: 'RATE_LIMITED', message: '429', retryable: true } });
  await assert.rejects(
    service.send({ provider, to: 'x@example.com', body: 'hello', idempotencyKey: 'send-fail' }),
    (error) => error.code === 'RATE_LIMITED' && error.retryable === true,
  );
  assert.equal(await store.getSend('send-fail'), null);
});

test('email capability risks preserve read-first / write-approval model', () => {
  const { service, provider } = fixture();
  const definitions = [];
  const naia = { registerCapability(value) { definitions.push(value); return { name: value.name, risk: value.tool.risk }; } };
  const registered = registerEmailCapabilities(naia, { service, provider });
  assert.deepEqual(registered, [
    { name: 'email.search', risk: 'SENSITIVE' },
    { name: 'email.read', risk: 'SENSITIVE' },
    { name: 'email.send', risk: 'EXTERNAL_WRITE' },
  ]);
  const send = definitions.find((d) => d.name === 'email.send');
  assert.equal(send.rule.action({ id: 'objective-1', title: 'send email hello' }).requiresApproval, true);
  assert.equal(send.rule.action({ id: 'objective-1', title: 'send email hello' }).risk, 'EXTERNAL_WRITE');
});

test('read operations are never classified as external writes', () => {
  const { service, provider } = fixture();
  const definitions = [];
  const naia = { registerCapability(value) { definitions.push(value); return value; } };
  registerEmailCapabilities(naia, { service, provider });
  for (const name of ['email.search', 'email.read']) {
    const definition = definitions.find((d) => d.name === name);
    assert.notEqual(definition.tool.risk, 'EXTERNAL_WRITE');
  }
});

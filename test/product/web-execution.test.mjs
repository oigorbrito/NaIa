import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  compareWebOptions,
  createFileWebExecutionStore,
  createFixtureWebAdapter,
  createWebExecutionService,
  proposeWebSubmission,
  registerWebExecutionCapabilities,
} from '../../src/product/web-execution.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';

function fixture(options = {}) {
  let id = 0;
  const adapter = createFixtureWebAdapter({
    searchResults: {
      shoes: [
        { id: 'a', source: 'store-a', url: 'https://shop.example/a', price: 100, fees: 10 },
        { id: 'b', source: 'store-b', url: 'https://shop.example/b', price: 95, fees: 20 },
      ],
    },
    forms: {
      booking: { url: 'https://book.example/form', revision: '1', summary: 'Table for 2', irreversible: true },
    },
    ...options,
  });
  const service = createWebExecutionService({ adapter, idFactory: () => 'run-' + ++id, now: () => '2026-09-19T13:00:00.000Z' });
  return { adapter, service };
}

test('comparison normalizes total cost and sorts deterministically', () => {
  const compared = compareWebOptions([
    { id: 'b', price: 90, fees: 20 },
    { id: 'a', price: 100, fees: 5 },
  ]);
  assert.deepEqual(compared.map((row) => [row.id, row.total]), [['a', 105], ['b', 110]]);
});

test('controlled search returns multi-source options and evidence', async () => {
  const { service } = fixture();
  const run = await service.createRun({ userId: 'u1', objective: 'compare shoes', allowedDomains: ['shop.example'] });
  const result = await service.search(run.id, { query: 'shoes' });
  assert.equal(result.options.length, 2);
  assert.equal(result.comparison[0].id, 'a');
  const saved = await service.get(run.id);
  assert.ok(saved.evidence.some((row) => row.type === 'WEB_SEARCH_COMPLETED' && row.resultCount === 2));
});

test('domain allowlist blocks unexpected navigation target', async () => {
  const { service } = fixture({ searchResults: { bad: [{ id: 'x', url: 'https://evil.example/x', price: 1 }] } });
  const run = await service.createRun({ userId: 'u1', objective: 'safe search', allowedDomains: ['shop.example'] });
  await assert.rejects(service.search(run.id, { query: 'bad' }), (error) => error.code === 'DOMAIN_BLOCKED');
  const saved = await service.get(run.id);
  assert.ok(saved.evidence.some((row) => row.type === 'WEB_SEARCH_FAILED'));
});

test('form preparation creates concrete approval checkpoint without submitting', async () => {
  const { service, adapter } = fixture();
  const run = await service.createRun({ userId: 'u1', objective: 'book table', allowedDomains: ['book.example'] });
  const preview = await service.prepareForm(run.id, { targetId: 'booking', fields: { partySize: 2, time: '19:00' } });
  assert.equal(preview.requiresApproval, true);
  assert.equal(adapter.submissions().length, 0);
  const saved = await service.get(run.id);
  assert.equal(saved.state, 'WAITING_APPROVAL');
  assert.equal(saved.pendingSubmission.fingerprint, preview.fingerprint);
});

test('approved concrete submission commits once and duplicate retry is idempotent', async () => {
  const { service, adapter } = fixture();
  const run = await service.createRun({ userId: 'u1', objective: 'book table', allowedDomains: ['book.example'] });
  const preview = await service.prepareForm(run.id, { targetId: 'booking', fields: { partySize: 2 } });
  await service.approve(run.id, preview.fingerprint);
  const first = await service.submit(run.id, { fingerprint: preview.fingerprint, idempotencyKey: 'booking-commit-1' });
  const duplicate = await service.submit(run.id, { fingerprint: preview.fingerprint, idempotencyKey: 'booking-commit-1' });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(adapter.submissions().length, 1);
  assert.equal((await service.get(run.id)).state, 'COMPLETED');
});

test('changed page revision invalidates approval instead of silently committing new terms', async () => {
  const { service, adapter } = fixture();
  const run = await service.createRun({ userId: 'u1', objective: 'book table', allowedDomains: ['book.example'] });
  const preview = await service.prepareForm(run.id, { targetId: 'booking', fields: { partySize: 2 } });
  await service.approve(run.id, preview.fingerprint);
  adapter.setRevision('booking', '2');
  await assert.rejects(
    service.submit(run.id, { fingerprint: preview.fingerprint, idempotencyKey: 'booking-stale-1' }),
    (error) => error.code === 'STALE_PAGE',
  );
  const saved = await service.get(run.id);
  assert.equal(saved.state, 'WAITING_REVIEW');
  assert.equal(saved.approvedFingerprint, null);
  assert.equal(adapter.submissions().length, 0);
});

test('cancellation prevents later irreversible submission', async () => {
  const { service, adapter } = fixture();
  const run = await service.createRun({ userId: 'u1', objective: 'book table', allowedDomains: ['book.example'] });
  const preview = await service.prepareForm(run.id, { targetId: 'booking', fields: { partySize: 2 } });
  await service.approve(run.id, preview.fingerprint);
  await service.cancel(run.id);
  await assert.rejects(
    service.submit(run.id, { fingerprint: preview.fingerprint, idempotencyKey: 'cancelled-1' }),
    (error) => error.code === 'CANCELLED',
  );
  assert.equal(adapter.submissions().length, 0);
});

test('retryable navigation failure is evidenced and a later search can resume safely', async () => {
  const { service } = fixture({ failSearchTimes: 1 });
  const run = await service.createRun({ userId: 'u1', objective: 'compare shoes', allowedDomains: ['shop.example'] });
  await assert.rejects(service.search(run.id, { query: 'shoes' }), (error) => error.code === 'NAVIGATION_FAILED' && error.retryable === true);
  const recovered = await service.search(run.id, { query: 'shoes' });
  assert.equal(recovered.options.length, 2);
  const saved = await service.get(run.id);
  assert.equal(saved.evidence.filter((row) => row.type === 'WEB_SEARCH_FAILED').length, 1);
  assert.equal(saved.evidence.filter((row) => row.type === 'WEB_SEARCH_COMPLETED').length, 1);
});

test('capability registration keeps search read-only and submit external-write', () => {
  const { service } = fixture();
  const definitions = [];
  const naia = { registerCapability(value) { definitions.push(value); return { name: value.name, risk: value.tool.risk }; } };
  const registered = registerWebExecutionCapabilities(naia, { service });
  assert.deepEqual(registered, [
    { name: 'web.search', risk: 'READ_ONLY' },
    { name: 'web.submit', risk: 'EXTERNAL_WRITE' },
  ]);
  assert.equal(definitions.find((row) => row.name === 'web.submit').rule.action({ id: 'r1' }).requiresApproval, true);
});

test('runtime approval is the single authority for irreversible web submission',async()=>{
  const {service,adapter}=fixture();
  const run=await service.createRun({userId:'u1',objective:'book table',allowedDomains:['book.example']});
  const preview=await service.prepareForm(run.id,{targetId:'booking',fields:{partySize:2}});
  const naia=createNaiaService(createInMemoryPorts());registerWebExecutionCapabilities(naia,{service});
  const pending=await proposeWebSubmission(naia,{runId:run.id,fingerprint:preview.fingerprint,idempotencyKey:'runtime-web-1'});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  assert.equal(adapter.submissions().length,0);
  const completed=await naia.approve(pending.objective.id,'web.submit');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.equal(adapter.submissions().length,1);
  const saved=await service.get(run.id);
  assert.equal(saved.state,'COMPLETED');
  assert.ok(saved.evidence.some(row=>row.type==='WEB_SUBMISSION_APPROVED'&&row.authority==='NAIA_RUNTIME'));
});

test('page revision change after runtime approval fails closed and requires renewed review',async()=>{
  const {service,adapter}=fixture();
  const run=await service.createRun({userId:'u1',objective:'book table',allowedDomains:['book.example']});
  const preview=await service.prepareForm(run.id,{targetId:'booking',fields:{partySize:2}});
  const naia=createNaiaService(createInMemoryPorts());registerWebExecutionCapabilities(naia,{service});
  const pending=await proposeWebSubmission(naia,{runId:run.id,fingerprint:preview.fingerprint,idempotencyKey:'runtime-stale'});
  adapter.setRevision('booking','2');
  const failed=await naia.approve(pending.objective.id,'web.submit');
  assert.equal(failed.objective.status,'FAILED');
  const saved=await service.get(run.id);
  assert.equal(saved.state,'WAITING_REVIEW');
  assert.equal(saved.approvedFingerprint,null);
  assert.equal(adapter.submissions().length,0);
});

test('web run and commit idempotency survive file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-web-'));
  try{
    const adapter=createFixtureWebAdapter({forms:{booking:{url:'https://book.example/form',revision:'1',irreversible:true}}});
    let id=0;
    const first=createWebExecutionService({store:createFileWebExecutionStore({rootDir:dir}),adapter,idFactory:()=>`run-${++id}`,now:()=> '2026-09-19T13:00:00Z'});
    const run=await first.createRun({userId:'u1',objective:'book',allowedDomains:['book.example']});
    const preview=await first.prepareForm(run.id,{targetId:'booking',fields:{partySize:2}});
    await first.executeRuntimeApproved(run.id,{fingerprint:preview.fingerprint,idempotencyKey:'commit-1'});
    const second=createWebExecutionService({store:createFileWebExecutionStore({rootDir:dir}),adapter,now:()=> '2026-09-19T14:00:00Z'});
    const duplicate=await second.submit(run.id,{fingerprint:preview.fingerprint,idempotencyKey:'commit-1'});
    assert.equal(duplicate.duplicate,true);
    assert.equal(adapter.submissions().length,1);
    assert.equal((await second.get(run.id)).state,'COMPLETED');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('cancelled run cannot be revived by runtime approval',async()=>{
  const {service,adapter}=fixture();
  const run=await service.createRun({userId:'u1',objective:'book table',allowedDomains:['book.example']});
  const preview=await service.prepareForm(run.id,{targetId:'booking',fields:{partySize:2}});
  await service.cancel(run.id);
  const naia=createNaiaService(createInMemoryPorts());registerWebExecutionCapabilities(naia,{service});
  const pending=await proposeWebSubmission(naia,{runId:run.id,fingerprint:preview.fingerprint,idempotencyKey:'cancelled-runtime'});
  const failed=await naia.approve(pending.objective.id,'web.submit');
  assert.equal(failed.objective.status,'FAILED');
  assert.equal(adapter.submissions().length,0);
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createBookingService, createFileBookingStore, createFixtureBookingProvider, normalizeBookingIntent, proposeBookingCommit, registerBookingCapabilities } from '../../src/product/booking.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';

function fixture(options = {}) {
  let id = 0;
  const provider = createFixtureBookingProvider({
    name: 'restaurant-provider',
    options: [
      { id: 'slot-1', slot: '2026-09-20T19:00:00-03:00', location: 'Centro', price: 0, revision: '1', terms: { table: 'standard' }, cancellationPolicy: { freeUntilHours: 2 } },
      { id: 'slot-2', slot: '2026-09-20T20:00:00-03:00', location: 'Centro', price: 10, revision: '1', terms: { table: 'window' }, cancellationPolicy: { freeUntilHours: 2 } },
    ],
    ...options,
  });
  const service = createBookingService({ providers: [provider], idFactory: () => 'id-' + ++id, now: () => '2026-09-19T13:00:00.000Z' });
  return { provider, service };
}

test('normalizes booking intent deterministically', () => {
  assert.deepEqual(normalizeBookingIntent({ kind: 'Restaurant', resource: 'Dinner', partySize: 2, location: 'Centro', date: '2026-09-20' }), {
    kind: 'restaurant', resource: 'Dinner', partySize: 2, location: 'Centro', date: '2026-09-20', timeWindow: null, constraints: {},
  });
});

test('discovers concrete provider availability with terms and revision evidence', async () => {
  const { service } = fixture();
  const result = await service.discover({ kind: 'restaurant', partySize: 2, date: '2026-09-20' });
  assert.equal(result.options.length, 2);
  assert.equal(result.options[0].provider, 'restaurant-provider');
  assert.equal(result.options[0].revision, '1');
  assert.deepEqual(result.options[0].cancellationPolicy, { freeUntilHours: 2 });
});

test('booking creation requires approval bound to exact option revision', async () => {
  const { service } = fixture();
  const discovery = await service.discover({ kind: 'restaurant', partySize: 2 });
  const action = await service.prepareCreate({ userId: 'u1', intent: discovery.intent, option: discovery.options[0] });
  await assert.rejects(service.execute(action.id, { fingerprint: action.fingerprint, idempotencyKey: 'create-1' }), (error) => error.code === 'APPROVAL_REQUIRED');
  await service.approve(action.id, action.fingerprint);
  const committed = await service.execute(action.id, { fingerprint: action.fingerprint, idempotencyKey: 'create-1' });
  assert.equal(committed.booking.state, 'CONFIRMED');
  assert.equal(committed.booking.optionId, 'slot-1');
});

test('stale availability invalidates create action instead of silently booking changed slot', async () => {
  const { service, provider } = fixture();
  const discovery = await service.discover({ kind: 'restaurant', partySize: 2 });
  const action = await service.prepareCreate({ userId: 'u1', intent: discovery.intent, option: discovery.options[0] });
  await service.approve(action.id, action.fingerprint);
  provider.setOptionRevision('slot-1', '2');
  await assert.rejects(service.execute(action.id, { fingerprint: action.fingerprint, idempotencyKey: 'stale-create' }), (error) => error.code === 'AVAILABILITY_CHANGED');
  assert.equal((await service.getAction(action.id)).status, 'WAITING_REVIEW');
});

test('retry after provider timeout is safe and idempotent at commit boundary', async () => {
  const { service } = fixture({ timeoutTimes: 1 });
  const discovery = await service.discover({ kind: 'restaurant', partySize: 2 });
  const action = await service.prepareCreate({ userId: 'u1', intent: discovery.intent, option: discovery.options[0] });
  await service.approve(action.id, action.fingerprint);
  await assert.rejects(service.execute(action.id, { fingerprint: action.fingerprint, idempotencyKey: 'timeout-create' }), (error) => error.code === 'PROVIDER_TIMEOUT' && error.retryable === true);
  const retry = await service.execute(action.id, { fingerprint: action.fingerprint, idempotencyKey: 'timeout-create' });
  assert.equal(retry.duplicate, false);
  const duplicate = await service.execute(action.id, { fingerprint: action.fingerprint, idempotencyKey: 'timeout-create' });
  assert.equal(duplicate.duplicate, true);
});

test('cancel targets exact existing booking identity and requires new approval', async () => {
  const { service } = fixture();
  const discovery = await service.discover({ kind: 'restaurant', partySize: 2 });
  const create = await service.prepareCreate({ userId: 'u1', intent: discovery.intent, option: discovery.options[0] });
  await service.approve(create.id, create.fingerprint);
  const created = await service.execute(create.id, { fingerprint: create.fingerprint, idempotencyKey: 'create-cancel-test' });
  const cancel = await service.prepareMutation({ userId: 'u1', bookingId: created.booking.id, type: 'CANCEL' });
  await assert.rejects(service.execute(cancel.id, { fingerprint: cancel.fingerprint, idempotencyKey: 'cancel-1' }), (error) => error.code === 'APPROVAL_REQUIRED');
  await service.approve(cancel.id, cancel.fingerprint);
  const cancelled = await service.execute(cancel.id, { fingerprint: cancel.fingerprint, idempotencyKey: 'cancel-1' });
  assert.equal(cancelled.booking.id, created.booking.id);
  assert.equal(cancelled.booking.state, 'CANCELLED');
});

test('reschedule approval is bound to target option revision', async () => {
  const { service, provider } = fixture();
  const discovery = await service.discover({ kind: 'restaurant', partySize: 2 });
  const create = await service.prepareCreate({ userId: 'u1', intent: discovery.intent, option: discovery.options[0] });
  await service.approve(create.id, create.fingerprint);
  const created = await service.execute(create.id, { fingerprint: create.fingerprint, idempotencyKey: 'create-reschedule-test' });
  const reschedule = await service.prepareMutation({ userId: 'u1', bookingId: created.booking.id, type: 'RESCHEDULE', targetOption: discovery.options[1] });
  await service.approve(reschedule.id, reschedule.fingerprint);
  provider.setOptionRevision('slot-2', '2');
  await assert.rejects(service.execute(reschedule.id, { fingerprint: reschedule.fingerprint, idempotencyKey: 'reschedule-stale' }), (error) => error.code === 'AVAILABILITY_CHANGED');
  assert.equal((await service.getAction(reschedule.id)).status, 'WAITING_REVIEW');
});

test('successful reschedule mutates same booking lifecycle identity', async () => {
  const { service } = fixture();
  const discovery = await service.discover({ kind: 'restaurant', partySize: 2 });
  const create = await service.prepareCreate({ userId: 'u1', intent: discovery.intent, option: discovery.options[0] });
  await service.approve(create.id, create.fingerprint);
  const created = await service.execute(create.id, { fingerprint: create.fingerprint, idempotencyKey: 'create-reschedule-ok' });
  const reschedule = await service.prepareMutation({ userId: 'u1', bookingId: created.booking.id, type: 'RESCHEDULE', targetOption: discovery.options[1] });
  await service.approve(reschedule.id, reschedule.fingerprint);
  const moved = await service.execute(reschedule.id, { fingerprint: reschedule.fingerprint, idempotencyKey: 'reschedule-ok' });
  assert.equal(moved.booking.id, created.booking.id);
  assert.equal(moved.booking.optionId, 'slot-2');
  assert.equal(moved.booking.state, 'CONFIRMED');
});

test('booking/action/commit lifecycle survives file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-booking-'));
  try{
    let id=0;
    const provider=createFixtureBookingProvider({name:'restaurant-provider',options:[{id:'slot-1',slot:'2026-09-20T19:00:00-03:00',revision:'1'}]});
    const first=createBookingService({providers:[provider],store:createFileBookingStore({rootDir:dir}),idFactory:()=>`id-${++id}`,now:()=> '2026-09-19T13:00:00Z'});
    const discovery=await first.discover({kind:'restaurant',partySize:2});
    const action=await first.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
    await first.approve(action.id,action.fingerprint);
    const created=await first.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'create-1'});
    const second=createBookingService({providers:[provider],store:createFileBookingStore({rootDir:dir}),now:()=> '2026-09-19T14:00:00Z'});
    assert.equal((await second.getBooking(created.booking.id)).providerBookingId,created.booking.providerBookingId);
    const duplicate=await second.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'create-1'});
    assert.equal(duplicate.duplicate,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('booking create goes through normal WAITING_APPROVAL runtime flow',async()=>{
  const {service,provider}=fixture();
  const discovery=await service.discover({kind:'restaurant',partySize:2});
  const action=await service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  const naia=createNaiaService(createInMemoryPorts());registerBookingCapabilities(naia,{service});
  const pending=await proposeBookingCommit(naia,action,{idempotencyKey:'runtime-create'});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  const completed=await naia.approve(pending.objective.id,'booking.commit');
  assert.equal(completed.objective.status,'COMPLETED');
  const bookings=[...(await service.getBooking('id-2')?[await service.getBooking('id-2')]:[])];
  assert.equal(bookings.length,1);
});

test('stale availability after runtime approval fails closed into WAITING_REVIEW',async()=>{
  const {service,provider}=fixture();
  const discovery=await service.discover({kind:'restaurant',partySize:2});
  const action=await service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  const naia=createNaiaService(createInMemoryPorts());registerBookingCapabilities(naia,{service});
  const pending=await proposeBookingCommit(naia,action,{idempotencyKey:'runtime-stale'});
  provider.setOptionRevision('slot-1','2');
  const failed=await naia.approve(pending.objective.id,'booking.commit');
  assert.equal(failed.objective.status,'FAILED');
  assert.equal((await service.getAction(action.id)).status,'WAITING_REVIEW');
});

test('cancel and reschedule each require fresh runtime approval on exact booking identity',async()=>{
  const {service}=fixture();
  const discovery=await service.discover({kind:'restaurant',partySize:2});
  const create=await service.prepareCreate({userId:'u1',intent:discovery.intent,option:discovery.options[0]});
  await service.approve(create.id,create.fingerprint);
  const created=await service.execute(create.id,{fingerprint:create.fingerprint,idempotencyKey:'seed'});
  const naia=createNaiaService(createInMemoryPorts());registerBookingCapabilities(naia,{service});
  const reschedule=await service.prepareMutation({userId:'u1',bookingId:created.booking.id,type:'RESCHEDULE',targetOption:discovery.options[1]});
  const movePending=await proposeBookingCommit(naia,reschedule,{idempotencyKey:'move'});
  assert.equal(movePending.objective.status,'WAITING_APPROVAL');
  const moved=await naia.approve(movePending.objective.id,'booking.commit');
  assert.equal(moved.objective.status,'COMPLETED');
  assert.equal((await service.getBooking(created.booking.id)).optionId,'slot-2');
  const cancel=await service.prepareMutation({userId:'u1',bookingId:created.booking.id,type:'CANCEL'});
  const cancelPending=await proposeBookingCommit(naia,cancel,{idempotencyKey:'cancel'});
  assert.equal(cancelPending.objective.status,'WAITING_APPROVAL');
  const cancelled=await naia.approve(cancelPending.objective.id,'booking.commit');
  assert.equal(cancelled.objective.status,'COMPLETED');
  assert.equal((await service.getBooking(created.booking.id)).state,'CANCELLED');
});

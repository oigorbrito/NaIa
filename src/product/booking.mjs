import { createHash, randomUUID } from 'node:crypto';

function clone(value) { return structuredClone(value); }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function normalizeBookingIntent(input = {}) {
  return {
    kind: String(input.kind ?? 'reservation').toLowerCase(),
    resource: String(input.resource ?? '').trim() || null,
    partySize: Number.isFinite(Number(input.partySize)) ? Number(input.partySize) : 1,
    location: input.location ?? null,
    date: input.date ?? null,
    timeWindow: clone(input.timeWindow ?? null),
    constraints: clone(input.constraints ?? {}),
  };
}

export function createMemoryBookingStore() {
  const bookings = new Map();
  const actions = new Map();
  const commits = new Map();
  return {
    async saveBooking(row) { bookings.set(row.id, clone(row)); return clone(row); },
    async getBooking(id) { const row = bookings.get(id); return row ? clone(row) : null; },
    async saveAction(row) { actions.set(row.id, clone(row)); return clone(row); },
    async getAction(id) { const row = actions.get(id); return row ? clone(row) : null; },
    async saveCommit(key, row) { commits.set(key, clone(row)); return clone(row); },
    async getCommit(key) { const row = commits.get(key); return row ? clone(row) : null; },
  };
}

export function createFixtureBookingProvider({
  name = 'fixture-booking',
  options = [],
  timeoutTimes = 0,
} = {}) {
  const mutable = new Map(options.map((option) => [String(option.id), clone(option)]));
  const reservations = new Map();
  let remainingTimeouts = timeoutTimes;
  return {
    name,
    async availability() { return [...mutable.values()].filter((row) => row.available !== false).map(clone); },
    async book({ optionId, expectedRevision, idempotencyKey, intent }) {
      const existing = [...reservations.values()].find((row) => row.idempotencyKey === idempotencyKey && row.operation === 'CREATE');
      if (existing) return clone(existing.result);
      if (remainingTimeouts > 0) { remainingTimeouts -= 1; const e = new Error('provider timeout'); e.code = 'PROVIDER_TIMEOUT'; e.retryable = true; throw e; }
      const option = mutable.get(String(optionId));
      if (!option || option.available === false) { const e = new Error('availability lost'); e.code = 'AVAILABILITY_LOST'; throw e; }
      if (String(option.revision ?? '1') !== String(expectedRevision)) { const e = new Error('availability changed'); e.code = 'AVAILABILITY_CHANGED'; e.currentRevision = String(option.revision ?? '1'); throw e; }
      const providerBookingId = 'booking-' + (reservations.size + 1);
      const result = { providerBookingId, optionId: String(optionId), slot: option.slot, price: option.price ?? null, terms: clone(option.terms ?? null), cancellationPolicy: clone(option.cancellationPolicy ?? null), revision: '1', intent: clone(intent) };
      reservations.set(providerBookingId, { operation: 'CREATE', idempotencyKey, result: clone(result), state: 'CONFIRMED' });
      return result;
    },
    async mutate({ providerBookingId, type, expectedRevision, targetOptionId = null, expectedTargetRevision = null, idempotencyKey }) {
      const duplicate = [...reservations.values()].find((row) => row.idempotencyKey === idempotencyKey && row.operation === type);
      if (duplicate) return clone(duplicate.result);
      const existing = reservations.get(providerBookingId);
      if (!existing) { const e = new Error('booking not found'); e.code = 'NOT_FOUND'; throw e; }
      if (String(existing.result.revision ?? '1') !== String(expectedRevision)) { const e = new Error('booking changed'); e.code = 'BOOKING_CHANGED'; throw e; }
      if (type === 'CANCEL') {
        existing.state = 'CANCELLED';
        existing.result = { ...existing.result, revision: String(Number(existing.result.revision ?? 1) + 1), cancelled: true };
        existing.operation = 'CANCEL'; existing.idempotencyKey = idempotencyKey;
        reservations.set(providerBookingId, existing);
        return clone(existing.result);
      }
      if (type === 'RESCHEDULE') {
        const option = mutable.get(String(targetOptionId));
        if (!option || option.available === false) { const e = new Error('availability lost'); e.code = 'AVAILABILITY_LOST'; throw e; }
        if (expectedTargetRevision != null && String(option.revision ?? '1') !== String(expectedTargetRevision)) { const e = new Error('target availability changed'); e.code = 'AVAILABILITY_CHANGED'; e.currentRevision = String(option.revision ?? '1'); throw e; }
        existing.result = { ...existing.result, optionId: String(targetOptionId), slot: option.slot, price: option.price ?? existing.result.price, revision: String(Number(existing.result.revision ?? 1) + 1) };
        existing.operation = 'RESCHEDULE'; existing.idempotencyKey = idempotencyKey;
        reservations.set(providerBookingId, existing);
        return clone(existing.result);
      }
      throw new Error('unsupported booking mutation: ' + type);
    },
    setOptionRevision(id, revision) { const row = mutable.get(String(id)); if (row) row.revision = revision; },
    setAvailable(id, available) { const row = mutable.get(String(id)); if (row) row.available = available; },
  };
}

export function createBookingService({ store = createMemoryBookingStore(), providers = [], idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  const providerMap = new Map(providers.map((provider) => [provider.name, provider]));

  async function evidenceAction(action, event, details = {}) {
    action.evidence.push({ event, timestamp: now(), ...clone(details) });
    action.updatedAt = now();
    await store.saveAction(action);
  }

  return {
    async discover(intentInput) {
      const intent = normalizeBookingIntent(intentInput);
      const options = [];
      for (const provider of providers) {
        const rows = await provider.availability({ intent: clone(intent) });
        for (const row of rows) options.push({
          provider: provider.name, optionId: String(row.id), slot: row.slot ?? null, location: row.location ?? null,
          price: row.price ?? null, currency: row.currency ?? null, terms: clone(row.terms ?? null), cancellationPolicy: clone(row.cancellationPolicy ?? null),
          revision: String(row.revision ?? '1'), observedAt: now(),
        });
      }
      return { intent, options };
    },

    async prepareCreate({ userId, intent, option }) {
      if (!providerMap.has(option?.provider)) throw new Error('booking provider not registered');
      const payload = { type: 'CREATE', userId, intent: normalizeBookingIntent(intent), option: clone(option) };
      const action = { id: idFactory(), userId, type: 'CREATE', status: 'WAITING_APPROVAL', fingerprint: fingerprint(payload), payload, approvedAt: null, evidence: [], createdAt: now(), updatedAt: now() };
      await store.saveAction(action);
      await evidenceAction(action, 'BOOKING_CREATE_PREPARED', { fingerprint: action.fingerprint, provider: option.provider, optionId: option.optionId, revision: option.revision });
      return clone(action);
    },

    async prepareMutation({ userId, bookingId, type, targetOption = null }) {
      if (!['CANCEL', 'RESCHEDULE'].includes(type)) throw new Error('unsupported booking mutation');
      const booking = await store.getBooking(bookingId);
      if (!booking) throw new Error('booking not found: ' + bookingId);
      const payload = { type, userId, bookingId, provider: booking.provider, providerBookingId: booking.providerBookingId, expectedRevision: booking.revision, targetOption: clone(targetOption) };
      const action = { id: idFactory(), userId, type, status: 'WAITING_APPROVAL', fingerprint: fingerprint(payload), payload, approvedAt: null, evidence: [], createdAt: now(), updatedAt: now() };
      await store.saveAction(action);
      await evidenceAction(action, 'BOOKING_MUTATION_PREPARED', { fingerprint: action.fingerprint, type, bookingId });
      return clone(action);
    },

    async approve(actionId, actionFingerprint) {
      const action = await store.getAction(actionId);
      if (!action) throw new Error('booking action not found: ' + actionId);
      if (action.fingerprint !== actionFingerprint) { const e = new Error('booking approval mismatch'); e.code = 'APPROVAL_MISMATCH'; throw e; }
      action.status = 'APPROVED'; action.approvedAt = now();
      await evidenceAction(action, 'BOOKING_ACTION_APPROVED', { fingerprint: actionFingerprint });
      return clone(action);
    },

    async execute(actionId, { fingerprint: approvedFingerprint, idempotencyKey }) {
      const action = await store.getAction(actionId);
      if (!action) throw new Error('booking action not found: ' + actionId);
      if (!idempotencyKey) throw new Error('idempotencyKey is required');
      const prior = await store.getCommit(idempotencyKey);
      if (prior) return { duplicate: true, ...clone(prior) };
      if (action.status !== 'APPROVED' || action.fingerprint !== approvedFingerprint) { const e = new Error('booking action requires matching approval'); e.code = 'APPROVAL_REQUIRED'; throw e; }
      const payload = action.payload;
      const providerName = payload.type === 'CREATE' ? payload.option.provider : payload.provider;
      const provider = providerMap.get(providerName);
      if (!provider) throw new Error('booking provider not registered: ' + providerName);
      try {
        let result;
        let booking;
        if (payload.type === 'CREATE') {
          result = await provider.book({ optionId: payload.option.optionId, expectedRevision: payload.option.revision, idempotencyKey, intent: payload.intent });
          booking = { id: idFactory(), userId: action.userId, provider: providerName, providerBookingId: result.providerBookingId, state: 'CONFIRMED', optionId: result.optionId, slot: result.slot, price: result.price, terms: clone(result.terms), cancellationPolicy: clone(result.cancellationPolicy), revision: String(result.revision ?? '1'), createdAt: now(), updatedAt: now() };
        } else {
          result = await provider.mutate({ providerBookingId: payload.providerBookingId, type: payload.type, expectedRevision: payload.expectedRevision, targetOptionId: payload.targetOption?.optionId ?? null, expectedTargetRevision: payload.targetOption?.revision ?? null, idempotencyKey });
          booking = await store.getBooking(payload.bookingId);
          booking.state = payload.type === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED';
          booking.optionId = result.optionId; booking.slot = result.slot; booking.price = result.price; booking.revision = String(result.revision ?? booking.revision); booking.updatedAt = now();
        }
        await store.saveBooking(booking);
        action.status = 'COMPLETED';
        await evidenceAction(action, 'BOOKING_ACTION_COMPLETED', { bookingId: booking.id, providerBookingId: booking.providerBookingId });
        const commit = { actionId, booking: clone(booking), committedAt: now() };
        await store.saveCommit(idempotencyKey, commit);
        return { duplicate: false, ...clone(commit) };
      } catch (error) {
        if (['AVAILABILITY_CHANGED', 'AVAILABILITY_LOST', 'BOOKING_CHANGED'].includes(error?.code)) action.status = 'WAITING_REVIEW';
        await evidenceAction(action, 'BOOKING_ACTION_FAILED', { code: error?.code ?? 'PROVIDER_ERROR', retryable: Boolean(error?.retryable) });
        throw error;
      }
    },

    async getBooking(id) { return store.getBooking(id); },
    async getAction(id) { return store.getAction(id); },
  };
}

import { createHmac, timingSafeEqual } from 'node:crypto';

function clone(value) { return value == null ? value : structuredClone(value); }
function header(headers, name) {
  const target = String(name).toLowerCase();
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers ?? {});
  const found = entries.find(([key]) => String(key).toLowerCase() === target);
  return found ? String(found[1]) : '';
}

export function createBearerIngressAuthenticator({ token } = {}) {
  const expected = String(token ?? '');
  return {
    authenticate(request) {
      if (!expected) throw new Error('ingress bearer token is not configured');
      const authorization = header(request?.headers, 'authorization');
      if (authorization !== `Bearer ${expected}`) throw new Error('trigger ingress authentication failed');
      return { authenticated: true, method: 'bearer' };
    },
  };
}

export function createHmacIngressAuthenticator({ secret, signatureHeader = 'x-naia-signature', algorithm = 'sha256' } = {}) {
  const key = String(secret ?? '');
  return {
    authenticate(request) {
      if (!key) throw new Error('ingress hmac secret is not configured');
      const rawBody = typeof request?.rawBody === 'string' ? request.rawBody : JSON.stringify(request?.body ?? {});
      const expected = createHmac(algorithm, key).update(rawBody).digest('hex');
      const supplied = header(request?.headers, signatureHeader).replace(/^sha256=/i, '');
      const a = Buffer.from(expected);
      const b = Buffer.from(supplied);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('trigger ingress authentication failed');
      return { authenticated: true, method: 'hmac', algorithm };
    },
  };
}

export function createTriggerIngress({ runtime, authenticator, source = 'http' } = {}) {
  if (!runtime?.dispatch) throw new Error('trigger runtime dispatch is required');
  if (!authenticator?.authenticate) throw new Error('trigger ingress authenticator is required');
  return {
    async handle(request) {
      if (String(request?.method ?? 'POST').toUpperCase() !== 'POST') return { status: 405, body: { error: 'method-not-allowed' } };
      let auth;
      try { auth = await authenticator.authenticate(request); }
      catch (error) { return { status: 401, body: { error: 'unauthorized', message: error?.message ?? String(error) } }; }
      let delivery;
      try {
        delivery = clone(request?.body ?? {});
        if (!delivery || Array.isArray(delivery) || typeof delivery !== 'object') throw new Error('trigger ingress body must be an object');
        delivery.source = String(delivery.source ?? source);
        const result = await runtime.dispatch(delivery);
        return { status: result.deduplicated ? 200 : 202, body: { ...result, auth } };
      } catch (error) {
        return { status: 400, body: { error: 'invalid-delivery', message: error?.message ?? String(error), auth } };
      }
    },
  };
}

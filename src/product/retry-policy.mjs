function clone(value) { return value == null ? value : structuredClone(value); }
function nowIso() { return new Date().toISOString(); }

export function createRetryPolicy({ maxAttempts = 5, baseDelayMs = 1000, maxDelayMs = 60000, multiplier = 2, retryable = () => true } = {}) {
  if (maxAttempts < 1) throw new Error('maxAttempts must be >= 1');
  return {
    maxAttempts,
    next({ attempt, error }) {
      const currentAttempt = Number(attempt ?? 1);
      const canRetry = currentAttempt < maxAttempts && Boolean(retryable(error));
      if (!canRetry) return { retry: false, delayMs: 0 };
      const delayMs = Math.min(maxDelayMs, Math.max(0, Math.round(baseDelayMs * (multiplier ** Math.max(0, currentAttempt - 1)))));
      return { retry: true, delayMs };
    },
  };
}

export function createDeadLetterStore(initial = []) {
  const rows = initial.map(clone);
  return {
    async append(entry) { rows.push(clone(entry)); return clone(entry); },
    async list({ automationId } = {}) { return rows.filter((row) => !automationId || row.automationId === automationId).map(clone); },
  };
}

export function createRetryingTriggerDispatcher({ runtime, retryPolicy = createRetryPolicy(), deadLetters = createDeadLetterStore(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!runtime?.dispatch) throw new Error('trigger runtime dispatch is required');
  return {
    async dispatch(delivery) {
      let attempt = 1;
      while (true) {
        try {
          const result = await runtime.dispatch(delivery);
          return { ...result, attempts: attempt };
        } catch (error) {
          const decision = retryPolicy.next({ attempt, error, delivery });
          if (!decision.retry) {
            const deadLetter = await deadLetters.append({
              automationId: String(delivery?.automationId ?? ''),
              delivery: clone(delivery),
              attempts: attempt,
              error: error?.message ?? String(error),
              failedAt: nowIso(),
            });
            const terminal = new Error(`trigger delivery dead-lettered after ${attempt} attempt(s): ${deadLetter.error}`);
            terminal.cause = error;
            terminal.deadLetter = deadLetter;
            throw terminal;
          }
          await sleep(decision.delayMs);
          attempt += 1;
        }
      }
    },
    async deadLetters(automationId) { return deadLetters.list({ automationId }); },
  };
}

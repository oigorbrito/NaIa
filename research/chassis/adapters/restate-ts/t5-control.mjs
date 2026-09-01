import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();
let releaseCompletion;
let released = false;
const completionGate = new Promise((resolve) => {
  releaseCompletion = () => {
    if (released) return false;
    released = true;
    resolve();
    return true;
  };
});

export function withT5RequestContext(context, fn) {
  return requestContext.run(context, fn);
}

export function currentT5RequestContext() {
  return requestContext.getStore() ?? null;
}

export function releaseT5Completion() {
  return releaseCompletion();
}

export async function waitForT5CompletionRelease() {
  await completionGate;
}

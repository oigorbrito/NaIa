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

export function withT12RequestContext(context, fn) {
  return requestContext.run(context, fn);
}

export function currentT12RequestContext() {
  return requestContext.getStore() ?? null;
}

export function releaseT12Completion() {
  return releaseCompletion();
}

export async function waitForT12CompletionRelease() {
  await completionGate;
}

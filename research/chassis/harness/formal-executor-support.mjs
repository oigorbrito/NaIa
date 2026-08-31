export const FORMAL_EXECUTOR_SUPPORT = Object.freeze({
  T7: Object.freeze({
    modes: Object.freeze(['local-process']),
    fault: 'worker-process-sigkill'
  }),
  T8: Object.freeze({
    modes: Object.freeze(['local-process', 'managed-controller']),
    fault: 'external-response-loss'
  })
});

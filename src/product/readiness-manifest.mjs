export const MVP_READINESS_MANIFEST = Object.freeze({
  schemaVersion: 1,
  expectedProductTests: 78,
  coreGates: Object.freeze([
    'LOCAL_PRODUCT_SUITE',
    'CLEAN_REPRODUCTION_1',
    'CLEAN_REPRODUCTION_2',
    'EXTERNAL_SCHEDULER_DELIVERY',
    'LIVE_PROVIDER_EVENT',
  ]),
  optionalCapabilityGates: Object.freeze([
    'LIVE_GCAL_READ',
  ]),
});

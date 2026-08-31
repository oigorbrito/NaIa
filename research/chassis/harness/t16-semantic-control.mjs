const SAFE_KINDS = new Set(['REJECTED_INCOMPATIBLE', 'ROUTED_TO_COMPATIBLE', 'EXPLICIT_MIGRATION']);

export function executeDeterministicT16Control({
  disposition = 'REJECTED_INCOMPATIBLE',
  dimension = 'applicationVersion',
  before = 'v1',
  after = 'v2',
  migrationIdentity = null,
  objectiveIdentity = 't16-control-objective'
} = {}) {
  if (!objectiveIdentity) throw new Error('objectiveIdentity is required');
  if (!dimension) throw new Error('dimension is required');

  const safeDisposition = SAFE_KINDS.has(disposition);
  const explicit = disposition !== 'UNKNOWN' && disposition !== 'SILENT_REINTERPRETATION';
  const migrationValid = disposition !== 'EXPLICIT_MIGRATION' || (typeof migrationIdentity === 'string' && migrationIdentity.length > 0);
  const silentSemanticChangeObserved = disposition === 'SILENT_REINTERPRETATION';
  const priorMeaningPreservedOrExplicitlyMigrated = safeDisposition && migrationValid;

  return {
    mutantId: 'T16',
    objectiveIdentity,
    semanticMutation: { dimension, before, after },
    durableCheckpointBeforeMutation: true,
    recoveryAttemptedUnderMutatedProfile: true,
    compatibilityDisposition: {
      kind: disposition,
      explicit,
      migrationIdentity
    },
    silentSemanticChangeObserved,
    priorMeaningPreservedOrExplicitlyMigrated,
    durableAuthorityAlive: true,
    deterministicScheduleObserved: true,
    rawNativeEvidence: {
      syntheticControl: true,
      schedule: [
        'durable-objective-under-A',
        'execution-boundary-stopped',
        `semantic-dimension-mutated:${dimension}`,
        'recovery-under-B-attempted',
        `compatibility-disposition:${disposition}`,
        'final-state-inspected'
      ]
    }
  };
}

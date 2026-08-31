const ALLOWED_VERDICTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE', 'PARTIAL']);
const CRITICAL_MUTANTS = new Set(['T5', 'T7', 'T8', 'T11', 'T12', 'T16']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function artifactValid(artifact) {
  return artifact && nonEmpty(artifact.name) && nonEmpty(artifact.sha256) && artifact.sha256.length >= 16;
}

export function validateExperimentRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return { valid: false, errors: ['record must be an object'] };

  if (record.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (!nonEmpty(record.experimentId)) errors.push('experimentId is required');
  if (!nonEmpty(record.candidate)) errors.push('candidate is required');
  if (!/^T([1-9]|1[0-6])$/.test(record.mutantId ?? '')) errors.push('mutantId must be T1..T16');
  if (!Number.isInteger(record.repetition) || record.repetition < 1) errors.push('repetition must be a positive integer');
  if (!ALLOWED_VERDICTS.has(record.verdict)) errors.push('invalid verdict');

  const setup = record.setup ?? {};
  if (!['READY', 'BLOCKED_SETUP'].includes(setup.status)) errors.push('setup.status must be READY or BLOCKED_SETUP');
  if (!nonEmpty(setup.candidateVersion)) errors.push('setup.candidateVersion is required');
  if (!nonEmpty(setup.adapterSha256)) errors.push('setup.adapterSha256 is required');
  if (!nonEmpty(setup.harnessSha256)) errors.push('setup.harnessSha256 is required');
  if (!setup.environment || !nonEmpty(setup.environment.os) || !nonEmpty(setup.environment.arch) || !nonEmpty(setup.environment.runtime)) {
    errors.push('setup.environment os/arch/runtime are required');
  }
  if (setup.cleanupVerifiedBeforeRun !== true && setup.status === 'READY') errors.push('READY setup requires cleanupVerifiedBeforeRun=true');

  const run = record.run ?? {};
  if (!nonEmpty(run.startedAt) || !nonEmpty(run.finishedAt)) errors.push('run timestamps are required');
  if (!run.fault || !nonEmpty(run.fault.intended)) errors.push('run.fault.intended is required');
  if (typeof run.fault?.injected !== 'boolean') errors.push('run.fault.injected must be boolean');
  if (!run.rawObservations || typeof run.rawObservations !== 'object') errors.push('run.rawObservations are required');
  if (!run.acceptanceChecks || typeof run.acceptanceChecks !== 'object') errors.push('run.acceptanceChecks are required');

  const cleanup = record.cleanup ?? {};
  if (!['PASS', 'FAIL', 'NOT_APPLICABLE'].includes(cleanup.status)) errors.push('cleanup.status is invalid');
  for (const key of ['workerCleanup', 'durableStateCleanup', 'oracleCleanup', 'temporaryResourcesCleanup']) {
    if (typeof cleanup[key] !== 'boolean') errors.push(`cleanup.${key} must be boolean`);
  }

  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0 || !record.artifacts.every(artifactValid)) {
    errors.push('at least one hashed artifact is required');
  }

  // Empirical classification rules.
  if (setup.status === 'BLOCKED_SETUP' && record.verdict !== 'BLOCKED') {
    errors.push('BLOCKED_SETUP must yield BLOCKED, never candidate PASS/FAIL');
  }
  if (setup.status === 'READY' && run.fault?.injected === false && record.verdict !== 'INCONCLUSIVE') {
    errors.push('fault not injected must yield INCONCLUSIVE');
  }
  if (record.verdict === 'PASS') {
    if (setup.status !== 'READY') errors.push('PASS requires READY setup');
    if (run.fault?.injected !== true) errors.push('PASS requires intended fault injection');
    if (cleanup.status === 'FAIL') errors.push('PASS cannot coexist with failed cleanup');
    const checks = Object.values(run.acceptanceChecks ?? {});
    if (checks.length === 0 || checks.some((value) => value !== true)) errors.push('PASS requires all predeclared acceptance checks=true');
  }
  if (record.verdict === 'FAIL') {
    if (setup.status !== 'READY') errors.push('FAIL requires READY setup');
    if (run.fault?.injected !== true) errors.push('FAIL requires intended fault injection');
    const checks = Object.values(run.acceptanceChecks ?? {});
    if (checks.length === 0 || checks.every((value) => value === true)) errors.push('FAIL requires at least one acceptance check=false');
  }

  if (CRITICAL_MUTANTS.has(record.mutantId) && record.verdict === 'PASS') {
    if (!nonEmpty(run.fault?.targetKind)) errors.push('critical PASS requires fault targetKind');
    if (run.fault?.targetIdentity === null || run.fault?.targetIdentity === undefined || run.fault?.targetIdentity === '') {
      errors.push('critical PASS requires concrete fault targetIdentity');
    }
    if (run.fault?.durableAuthorityAlive !== true) errors.push('critical PASS requires durableAuthorityAlive=true');
  }

  if (record.mutantId === 'T16' && record.verdict === 'PASS') {
    const mutation = run.rawObservations?.semanticMutation;
    if (!mutation || !nonEmpty(mutation.dimension) || mutation.before === undefined || mutation.after === undefined) {
      errors.push('T16 PASS requires semanticMutation dimension/before/after evidence');
    }
  }

  if (record.candidate === 'Trigger.dev' && record.mutantId === 'T7' && record.verdict === 'PASS') {
    if (!['worker-process', 'worker-container'].includes(run.fault?.targetKind)) {
      errors.push('Trigger.dev T7 PASS requires actual worker-process or worker-container target');
    }
    if (run.fault?.signal !== 'SIGKILL') errors.push('Trigger.dev T7 PASS requires SIGKILL');
  }

  return { valid: errors.length === 0, errors };
}

export function benchmarkEligible(records, faultSuite) {
  const errors = [];
  if (!Array.isArray(records) || records.length === 0) return { eligible: false, errors: ['no records'] };
  const candidate = records[0]?.candidate;
  if (!candidate || records.some((record) => record.candidate !== candidate)) errors.push('records must belong to one candidate');

  const required = new Set(faultSuite?.benchmarkEligibility?.forbidBlockedOrInconclusive ?? []);
  for (const mutantId of required) {
    const mutantRecords = records.filter((record) => record.mutantId === mutantId);
    if (mutantRecords.length === 0) {
      errors.push(`${mutantId}: no executed records`);
      continue;
    }
    for (const record of mutantRecords) {
      const validation = validateExperimentRecord(record);
      if (!validation.valid) errors.push(`${mutantId}: invalid record: ${validation.errors.join('; ')}`);
      if (['BLOCKED', 'INCONCLUSIVE'].includes(record.verdict)) errors.push(`${mutantId}: benchmark-ineligible verdict ${record.verdict}`);
    }
  }

  return { eligible: errors.length === 0, candidate, errors };
}

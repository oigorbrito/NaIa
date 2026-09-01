import { createHash } from 'node:crypto';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256Value(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

function hashIdentity(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function normalizedPackages(dependencyIdentity) {
  return [...(dependencyIdentity?.packages ?? [])]
    .map((entry) => ({
      package: entry?.package ?? null,
      expectedVersion: entry?.expectedVersion ?? null,
      declaredVersion: entry?.declaredVersion ?? null,
      installedVersion: entry?.installedVersion ?? null
    }))
    .sort((a, b) => String(a.package).localeCompare(String(b.package)));
}

function lifecycleRuntimeIdentity(record) {
  const candidate = record?.candidate;
  const receipt = record?.setup?.preRunCleanupReceipt ?? {};

  if (candidate === 'Temporal TypeScript') {
    return {
      kind: 'temporal-local-runtime',
      expectedProfile: receipt.expectedProfile ?? null,
      observedPlatform: receipt.observedPlatform ?? null,
      cliSha256: receipt.cliSha256 ?? null,
      versionOutput: receipt.versionOutput ?? null
    };
  }

  if (candidate === 'DBOS TypeScript') {
    return {
      kind: 'dbos-isolated-postgres-runtime',
      observedPlatform: receipt.observedPlatform ?? null,
      dockerVersion: receipt.dockerVersion ?? null,
      postgresImage: receipt.postgresImage ?? null,
      postgresImageIdentity: receipt.postgresImageIdentity ?? null
    };
  }

  return receipt.formalRuntimeIdentity ?? null;
}

function validateCommonIdentity(common, errors) {
  if (!nonEmpty(common.os)) errors.push('setup.environment.os is required for formal environment identity');
  if (!nonEmpty(common.arch)) errors.push('setup.environment.arch is required for formal environment identity');
  if (!nonEmpty(common.runtime)) errors.push('setup.environment.runtime is required for formal environment identity');
  if (common.packageManager !== null && !nonEmpty(common.packageManager)) {
    errors.push('setup.environment.packageManager must be null or a non-empty string');
  }
}

function validateCandidateProfile(profile, candidate, errors) {
  if (!nonEmpty(profile.candidateVersion)) errors.push('setup.candidateVersion is required for formal candidate profile identity');
  if (!nonEmpty(profile.candidateSourceRef)) errors.push('setup.candidateSourceRef is required for formal candidate profile identity');
  if (!sha256Value(profile.adapterSha256)) errors.push('setup.adapterSha256 must be a full SHA-256 for formal candidate profile identity');
  if (!sha256Value(profile.manifestSha256)) errors.push('setup.dependencyIdentity.manifestSha256 must be a full SHA-256');
  if (!Array.isArray(profile.packages) || profile.packages.length === 0) {
    errors.push('setup.dependencyIdentity.packages must contain the installed formal dependency set');
  } else {
    const names = new Set();
    for (const entry of profile.packages) {
      if (!nonEmpty(entry.package)) errors.push('formal dependency package name is required');
      if (entry.package && names.has(entry.package)) errors.push(`duplicate formal dependency identity for ${entry.package}`);
      if (entry.package) names.add(entry.package);
      if (!nonEmpty(entry.expectedVersion)) errors.push(`${entry.package ?? 'dependency'}: expectedVersion is required`);
      if (!nonEmpty(entry.declaredVersion)) errors.push(`${entry.package ?? 'dependency'}: declaredVersion is required`);
      if (!nonEmpty(entry.installedVersion)) errors.push(`${entry.package ?? 'dependency'}: installedVersion is required`);
      if (entry.expectedVersion !== entry.declaredVersion || entry.expectedVersion !== entry.installedVersion) {
        errors.push(`${entry.package ?? 'dependency'}: expected, declared and installed versions must match exactly`);
      }
    }
  }
  if (!nonEmpty(profile.mode)) errors.push('setup.parameters.mode is required for formal candidate profile identity');
  if (!nonEmpty(profile.workerAuthorityBoundary)) errors.push('setup.parameters.workerAuthorityBoundary is required for formal candidate profile identity');
  if (!sha256Value(profile.lifecycleQualificationSha256)) {
    errors.push('formal lifecycle qualification SHA-256 is required for formal candidate profile identity');
  }

  if (candidate === 'Temporal TypeScript') {
    if (!sha256Value(profile.runtimeIdentity?.cliSha256)) errors.push('Temporal formal runtime identity requires cliSha256');
    if (!nonEmpty(profile.runtimeIdentity?.versionOutput)) errors.push('Temporal formal runtime identity requires versionOutput');
    if (!profile.runtimeIdentity?.expectedProfile || typeof profile.runtimeIdentity.expectedProfile !== 'object') {
      errors.push('Temporal formal runtime identity requires expectedProfile');
    }
    if (!profile.runtimeIdentity?.observedPlatform || typeof profile.runtimeIdentity.observedPlatform !== 'object') {
      errors.push('Temporal formal runtime identity requires observedPlatform');
    }
  } else if (candidate === 'DBOS TypeScript') {
    if (!nonEmpty(profile.runtimeIdentity?.dockerVersion)) errors.push('DBOS formal runtime identity requires dockerVersion');
    if (!nonEmpty(profile.runtimeIdentity?.postgresImage)) errors.push('DBOS formal runtime identity requires postgresImage');
    if (!nonEmpty(profile.runtimeIdentity?.postgresImageIdentity)) errors.push('DBOS formal runtime identity requires postgresImageIdentity');
    if (!profile.runtimeIdentity?.observedPlatform || typeof profile.runtimeIdentity.observedPlatform !== 'object') {
      errors.push('DBOS formal runtime identity requires observedPlatform');
    }
  } else if (!profile.runtimeIdentity || typeof profile.runtimeIdentity !== 'object') {
    errors.push(`${candidate ?? 'candidate'}: formalRuntimeIdentity is required before formal benchmark admission`);
  }
}

export function deriveFormalEnvironmentIdentity(record) {
  if (record?.setup?.status !== 'READY') {
    return {
      applicable: false,
      valid: true,
      common: null,
      commonSha256: null,
      candidateProfile: null,
      candidateProfileSha256: null,
      errors: []
    };
  }

  const environment = record?.setup?.environment ?? {};
  const dependencyIdentity = record?.setup?.dependencyIdentity ?? {};
  const parameters = record?.setup?.parameters ?? {};
  const lifecycleQualification = environment.formalLifecycleQualification ?? {};

  const common = {
    os: environment.os ?? null,
    arch: environment.arch ?? null,
    runtime: environment.runtime ?? null,
    packageManager: environment.packageManager ?? null
  };

  const candidateProfile = {
    candidateVersion: record?.setup?.candidateVersion ?? null,
    candidateSourceRef: record?.setup?.candidateSourceRef ?? null,
    adapterSha256: record?.setup?.adapterSha256 ?? null,
    manifestSha256: dependencyIdentity.manifestSha256 ?? null,
    packages: normalizedPackages(dependencyIdentity),
    mode: parameters.mode ?? null,
    workerAuthorityBoundary: parameters.workerAuthorityBoundary ?? null,
    lifecycleQualificationSha256: lifecycleQualification.sha256 ?? null,
    runtimeIdentity: lifecycleRuntimeIdentity(record)
  };

  const errors = [];
  validateCommonIdentity(common, errors);
  validateCandidateProfile(candidateProfile, record?.candidate, errors);

  return {
    applicable: true,
    valid: errors.length === 0,
    common,
    commonSha256: errors.some((error) => error.startsWith('setup.environment.')) ? null : hashIdentity(common),
    candidateProfile,
    candidateProfileSha256: errors.length === 0 ? hashIdentity(candidateProfile) : null,
    errors
  };
}

export function assessFormalEnvironmentConsistency(records) {
  if (!Array.isArray(records)) {
    return {
      consistent: false,
      recordCount: 0,
      readyRecordCount: 0,
      commonEnvironmentSha256: null,
      commonEnvironmentSha256s: [],
      candidateProfiles: {},
      errors: ['records must be an array']
    };
  }

  const errors = [];
  const common = new Set();
  const candidateProfiles = new Map();
  let readyRecordCount = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const identity = deriveFormalEnvironmentIdentity(record);
    if (!identity.applicable) continue;
    readyRecordCount += 1;
    if (!identity.valid) {
      for (const error of identity.errors) errors.push(`record index ${index}: ${error}`);
      continue;
    }

    common.add(identity.commonSha256);
    const candidate = record?.candidate ?? 'unknown candidate';
    if (!candidateProfiles.has(candidate)) candidateProfiles.set(candidate, new Set());
    candidateProfiles.get(candidate).add(identity.candidateProfileSha256);
  }

  if (common.size > 1) {
    errors.push(`READY formal records span multiple common execution environment identities: ${[...common].sort().join(', ')}`);
  }

  const candidateProfileSummary = {};
  for (const [candidate, hashes] of candidateProfiles) {
    const sorted = [...hashes].sort();
    candidateProfileSummary[candidate] = sorted;
    if (sorted.length > 1) {
      errors.push(`${candidate}: READY formal records span multiple candidate execution profile identities: ${sorted.join(', ')}`);
    }
  }

  const commonSha256s = [...common].sort();
  return {
    consistent: errors.length === 0,
    recordCount: records.length,
    readyRecordCount,
    commonEnvironmentSha256: commonSha256s.length === 1 ? commonSha256s[0] : null,
    commonEnvironmentSha256s: commonSha256s,
    candidateProfiles: candidateProfileSummary,
    errors
  };
}

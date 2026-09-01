import { createHash } from 'node:crypto';

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256Value(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
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

export function formalExecutionEnvironmentIdentity(record) {
  const environment = record?.setup?.environment ?? {};
  if (!nonEmpty(environment.os) || !nonEmpty(environment.arch) || !nonEmpty(environment.runtime)) return null;
  return {
    os: environment.os,
    arch: environment.arch,
    runtime: environment.runtime
  };
}

export function formalCandidateRuntimeIdentity(record) {
  const setup = record?.setup ?? {};
  const dependencyIdentity = setup.dependencyIdentity ?? {};
  if (
    !nonEmpty(record?.candidate) ||
    !nonEmpty(setup.candidateVersion) ||
    !nonEmpty(setup.candidateSourceRef) ||
    !sha256Value(setup.adapterSha256) ||
    !sha256Value(dependencyIdentity.manifestSha256)
  ) return null;

  const packages = normalizedPackages(dependencyIdentity);
  if (packages.length === 0 || packages.some((entry) =>
    !nonEmpty(entry.package) ||
    !nonEmpty(entry.expectedVersion) ||
    !nonEmpty(entry.declaredVersion) ||
    !nonEmpty(entry.installedVersion)
  )) return null;

  return {
    candidate: record.candidate,
    candidateVersion: setup.candidateVersion,
    candidateSourceRef: setup.candidateSourceRef,
    adapterSha256: String(setup.adapterSha256).toLowerCase(),
    manifestSha256: String(dependencyIdentity.manifestSha256).toLowerCase(),
    packages
  };
}

export function formalExecutionEnvironmentFingerprint(record) {
  const identity = formalExecutionEnvironmentIdentity(record);
  return identity ? sha256(identity) : null;
}

export function formalCandidateRuntimeFingerprint(record) {
  const identity = formalCandidateRuntimeIdentity(record);
  return identity ? sha256(identity) : null;
}

export function assessFormalEnvironmentConsistency(records) {
  if (!Array.isArray(records)) {
    return {
      consistent: false,
      executionEnvironmentFingerprints: [],
      candidateRuntimeFingerprints: {},
      errors: ['records must be an array']
    };
  }

  const errors = [];
  const executionFingerprints = new Set();
  const candidateFingerprints = new Map();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const executionFingerprint = formalExecutionEnvironmentFingerprint(record);
    if (!executionFingerprint) errors.push(`ledger index ${index}: incomplete formal execution environment identity`);
    else executionFingerprints.add(executionFingerprint);

    const candidateFingerprint = formalCandidateRuntimeFingerprint(record);
    if (!candidateFingerprint) {
      errors.push(`ledger index ${index}: incomplete candidate runtime/dependency identity`);
      continue;
    }
    const candidate = record.candidate;
    if (!candidateFingerprints.has(candidate)) candidateFingerprints.set(candidate, new Set());
    candidateFingerprints.get(candidate).add(candidateFingerprint);
  }

  if (executionFingerprints.size > 1) {
    errors.push(`formal ledger spans multiple execution environments: ${[...executionFingerprints].sort().join(', ')}`);
  }

  for (const [candidate, fingerprints] of candidateFingerprints) {
    if (fingerprints.size > 1) {
      errors.push(`${candidate}: formal records span multiple candidate runtime/dependency identities: ${[...fingerprints].sort().join(', ')}`);
    }
  }

  return {
    consistent: errors.length === 0,
    executionEnvironmentFingerprint: executionFingerprints.size === 1 ? [...executionFingerprints][0] : null,
    executionEnvironmentFingerprints: [...executionFingerprints].sort(),
    candidateRuntimeFingerprints: Object.fromEntries(
      [...candidateFingerprints.entries()].map(([candidate, values]) => [candidate, [...values].sort()])
    ),
    errors
  };
}

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function defaultRepositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function sortedPackageEntries(value) {
  return Object.entries(value ?? {})
    .map(([packageName, version]) => ({ package: packageName, version }))
    .sort((a, b) => a.package.localeCompare(b.package));
}

function recordPackages(record) {
  return [...(record?.setup?.dependencyIdentity?.packages ?? [])]
    .map((entry) => ({
      package: entry?.package ?? null,
      expectedVersion: entry?.expectedVersion ?? null,
      declaredVersion: entry?.declaredVersion ?? null,
      installedVersion: entry?.installedVersion ?? null
    }))
    .sort((a, b) => String(a.package).localeCompare(String(b.package)));
}

function candidateEntry(repositoryRoot, candidateName) {
  const capabilities = readJson(path.join(repositoryRoot, 'research', 'chassis', 'adapter-capabilities.v1.json'));
  return (capabilities?.candidates ?? []).find((entry) => entry.candidate === candidateName) ?? null;
}

export function candidateProfileExpectation(repositoryRoot, candidateName) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  const candidate = candidateEntry(repositoryRoot, candidateName);
  if (!candidate) return null;

  const adapterPath = path.join(repositoryRoot, candidate.adapter);
  const manifestPath = path.join(repositoryRoot, candidate.package_manifest);
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const packages = sortedPackageEntries(candidate.execution_package);

  return {
    candidate: candidate.candidate,
    candidateVersion: candidate.version,
    candidateSourceRef: candidate.source_ref,
    adapterSha256: sha256(readFileSync(adapterPath)),
    manifestSha256: sha256(manifestBytes),
    mode: candidate.mode,
    workerAuthorityBoundary: candidate.worker_authority_boundary,
    packages: packages.map((entry) => ({
      package: entry.package,
      expectedVersion: entry.version,
      manifestDeclaredVersion: manifest.dependencies?.[entry.package] ?? manifest.devDependencies?.[entry.package] ?? null
    }))
  };
}

export function currentCandidateProfileExpectation(candidateName) {
  return candidateProfileExpectation(defaultRepositoryRoot(), candidateName);
}

export function candidateProfileRecordFields(candidateName, { installed = true } = {}) {
  const expected = currentCandidateProfileExpectation(candidateName);
  if (!expected) return null;
  return {
    candidateVersion: expected.candidateVersion,
    candidateSourceRef: expected.candidateSourceRef,
    adapterSha256: expected.adapterSha256,
    manifestSha256: expected.manifestSha256,
    mode: expected.mode,
    workerAuthorityBoundary: expected.workerAuthorityBoundary,
    packages: expected.packages.map((entry) => ({
      package: entry.package,
      expectedVersion: entry.expectedVersion,
      declaredVersion: entry.expectedVersion,
      installedVersion: installed ? entry.expectedVersion : null
    }))
  };
}

export function assessCandidateProfileBinding(record, repositoryRoot = defaultRepositoryRoot()) {
  const errors = [];
  const candidateName = record?.candidate ?? null;
  const setupStatus = record?.setup?.status ?? null;
  const requireInstalled = setupStatus === 'READY';
  let expected = null;
  try {
    expected = candidateProfileExpectation(repositoryRoot, candidateName);
  } catch (error) {
    return {
      bound: false,
      candidate: candidateName,
      expected: null,
      errors: [`candidate profile expectation unavailable: ${String(error)}`]
    };
  }

  if (!expected) {
    return { bound: false, candidate: candidateName, expected: null, errors: [`candidate not found in frozen capability matrix: ${candidateName ?? 'missing'}`] };
  }

  if (record?.setup?.candidateVersion !== expected.candidateVersion) {
    errors.push(`candidateVersion mismatch: expected ${expected.candidateVersion}, got ${record?.setup?.candidateVersion ?? 'missing'}`);
  }
  if (record?.setup?.candidateSourceRef !== expected.candidateSourceRef) {
    errors.push('candidateSourceRef differs from frozen capability matrix');
  }
  if (record?.setup?.adapterSha256 !== expected.adapterSha256) {
    errors.push('adapterSha256 differs from current frozen adapter bytes');
  }
  if (record?.setup?.dependencyIdentity?.manifestSha256 !== expected.manifestSha256) {
    errors.push('manifestSha256 differs from current frozen package manifest bytes');
  }
  if (record?.setup?.parameters?.mode !== expected.mode) {
    errors.push(`execution mode mismatch: expected ${expected.mode}, got ${record?.setup?.parameters?.mode ?? 'missing'}`);
  }
  if (record?.setup?.parameters?.workerAuthorityBoundary !== expected.workerAuthorityBoundary) {
    errors.push('workerAuthorityBoundary differs from frozen capability matrix');
  }

  for (const entry of expected.packages) {
    if (entry.manifestDeclaredVersion !== entry.expectedVersion) {
      errors.push(`${entry.package}: current package manifest does not exactly match frozen execution_package version ${entry.expectedVersion}`);
    }
  }

  const actualPackages = recordPackages(record);
  const expectedNames = expected.packages.map((entry) => entry.package);
  const actualNames = actualPackages.map((entry) => entry.package);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    errors.push(`formal dependency set mismatch: expected [${expectedNames.join(', ')}], got [${actualNames.join(', ')}]`);
  }

  for (const expectedPackage of expected.packages) {
    const actual = actualPackages.find((entry) => entry.package === expectedPackage.package);
    if (!actual) continue;
    if (
      actual.expectedVersion !== expectedPackage.expectedVersion ||
      actual.declaredVersion !== expectedPackage.expectedVersion
    ) {
      errors.push(`${expectedPackage.package}: record expected/declared versions must both equal frozen version ${expectedPackage.expectedVersion}`);
    }
    if (requireInstalled && actual.installedVersion !== expectedPackage.expectedVersion) {
      errors.push(`${expectedPackage.package}: READY record installedVersion must equal frozen version ${expectedPackage.expectedVersion}`);
    }
    if (!requireInstalled && actual.installedVersion !== null && actual.installedVersion !== expectedPackage.expectedVersion) {
      errors.push(`${expectedPackage.package}: blocked record installedVersion, when present, must equal frozen version ${expectedPackage.expectedVersion}`);
    }
  }

  return {
    bound: errors.length === 0,
    candidate: candidateName,
    setupStatus,
    expected,
    errors
  };
}

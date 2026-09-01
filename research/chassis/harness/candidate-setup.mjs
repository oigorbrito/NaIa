import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { computeHarnessProvenance } from './harness-provenance.mjs';
import { repositoryProvenanceReady } from './repository-provenance.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readable(file) {
  try { await access(file); return true; } catch { return false; }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function flattenPackages(candidate) {
  return Object.entries(candidate.execution_package ?? {}).map(([name, version]) => ({ name, version }));
}

function packageJsonPath(root, packageName) {
  return path.join(root, 'node_modules', ...packageName.split('/'), 'package.json');
}

export async function inspectCandidateSetup({
  candidate,
  repositoryRoot,
  harnessPath,
  env = process.env,
  formalProvenance = false,
  repositoryProvenance = null
}) {
  if (!candidate || typeof candidate !== 'object') throw new Error('candidate capability entry is required');
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  if (!harnessPath) throw new Error('harnessPath is required');

  const adapterPath = path.join(repositoryRoot, candidate.adapter);
  const manifestPath = path.join(repositoryRoot, candidate.package_manifest);
  const requiredEnv = candidate.required_env ?? [];
  const missingEnv = requiredEnv.filter((name) => !env[name]);

  const adapterPresent = await readable(adapterPath);
  const manifestPresent = await readable(manifestPath);
  const harnessPresent = await readable(harnessPath);

  const packageChecks = [];
  if (manifestPresent) {
    const manifest = await readJson(manifestPath);
    for (const expected of flattenPackages(candidate)) {
      const declared = manifest.dependencies?.[expected.name] ?? manifest.devDependencies?.[expected.name] ?? null;
      const installedPath = packageJsonPath(path.dirname(manifestPath), expected.name);
      const installedPresent = await readable(installedPath);
      let installedVersion = null;
      if (installedPresent) installedVersion = (await readJson(installedPath)).version ?? null;
      packageChecks.push({
        package: expected.name,
        expectedVersion: expected.version,
        declaredVersion: declared,
        declaredExact: declared === expected.version,
        installedPresent,
        installedVersion,
        installedExact: installedVersion === expected.version,
        installedPackageJson: installedPath
      });
    }
  }

  const dependencyIdentity = {
    manifestPath,
    manifestSha256: manifestPresent ? sha256(await readFile(manifestPath)) : null,
    packages: packageChecks.map((entry) => ({
      package: entry.package,
      expectedVersion: entry.expectedVersion,
      declaredVersion: entry.declaredVersion,
      installedVersion: entry.installedVersion,
      installedPackageJson: entry.installedPackageJson
    }))
  };

  let harnessProvenance = null;
  if (harnessPresent && formalProvenance) {
    try {
      harnessProvenance = await computeHarnessProvenance(repositoryRoot);
    } catch (error) {
      harnessProvenance = { error: String(error) };
    }
  }

  const blockers = [];
  if (!adapterPresent) blockers.push('ADAPTER_SOURCE_MISSING');
  if (!manifestPresent) blockers.push('PACKAGE_MANIFEST_MISSING');
  if (!harnessPresent) blockers.push('HARNESS_SOURCE_MISSING');
  if (formalProvenance && (!harnessProvenance || harnessProvenance.error)) blockers.push('HARNESS_PROVENANCE_INCOMPLETE');
  if (formalProvenance && !repositoryProvenanceReady(repositoryProvenance)) blockers.push('REPOSITORY_PROVENANCE_UNVERIFIED');
  if (packageChecks.some((entry) => !entry.declaredExact)) blockers.push('DEPENDENCY_PIN_MISMATCH');
  if (packageChecks.some((entry) => !entry.installedPresent)) blockers.push('DEPENDENCY_NOT_INSTALLED');
  if (packageChecks.some((entry) => entry.installedPresent && !entry.installedExact)) blockers.push('INSTALLED_DEPENDENCY_VERSION_MISMATCH');
  if (missingEnv.length > 0) blockers.push('REQUIRED_ENV_MISSING');

  const ready = blockers.length === 0;
  const harnessSha256 = harnessPresent
    ? formalProvenance
      ? (harnessProvenance?.aggregateSha256 ?? '')
      : sha256(await readFile(harnessPath))
    : '';

  if (formalProvenance) {
    dependencyIdentity.harnessProvenance = harnessProvenance;
    dependencyIdentity.repositoryProvenance = repositoryProvenance;
  }

  return {
    status: ready ? 'READY' : 'BLOCKED_SETUP',
    blocker: ready ? null : blockers.join('+'),
    candidateVersion: candidate.version,
    candidateSourceRef: candidate.source_ref ?? null,
    adapterSha256: adapterPresent ? sha256(await readFile(adapterPath)) : '',
    harnessSha256,
    dependencyIdentity,
    parameters: {
      mode: candidate.mode,
      workerAuthorityBoundary: candidate.worker_authority_boundary,
      requiredEnvNames: requiredEnv,
      missingEnvNames: missingEnv,
      blockerRegisterRef: candidate.blocker ?? null,
      harnessProvenanceMode: formalProvenance ? 'FORMAL_BUNDLE' : 'SINGLE_FILE',
      repositoryRevision: formalProvenance ? (repositoryProvenance?.revision ?? null) : null
    },
    cleanupVerifiedBeforeRun: false,
    diagnostics: {
      adapterPresent,
      manifestPresent,
      harnessPresent,
      harnessProvenance,
      repositoryProvenance,
      packageChecks,
      missingEnv,
      blockers,
      cleanupVerification: 'NOT_EVALUATED_BY_SETUP_INSPECTION'
    }
  };
}

export function candidateByName(capabilities, candidateName) {
  const candidate = (capabilities?.candidates ?? []).find((entry) => entry.candidate === candidateName);
  if (!candidate) throw new Error(`candidate not found in capability matrix: ${candidateName}`);
  return candidate;
}

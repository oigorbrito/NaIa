import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const manifestPath = path.resolve(repoRoot, 'research/chassis/adapter-capabilities.v1.json');

function flattenPackages(pkg) {
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

async function exists(relativePath) {
  try {
    await access(path.resolve(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function commandPresent(source, command) {
  return source.includes(`case '${command}'`) || source.includes(`case \"${command}\"`);
}

export async function runPreflight({ checkEnv = true } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const results = [];

  for (const candidate of manifest.candidates) {
    const checks = {};
    checks.adapterFile = await exists(candidate.adapter);
    checks.packageManifest = await exists(candidate.package_manifest);

    let adapterSource = '';
    let packageJson = {};
    if (checks.adapterFile) adapterSource = await readFile(path.resolve(repoRoot, candidate.adapter), 'utf8');
    if (checks.packageManifest) packageJson = JSON.parse(await readFile(path.resolve(repoRoot, candidate.package_manifest), 'utf8'));

    const installedSpec = flattenPackages(packageJson);
    checks.packagePins = Object.entries(candidate.execution_package).every(([name, version]) => installedSpec[name] === version);
    checks.expectedCommands = candidate.expected_commands.every((command) => commandPresent(adapterSource, command));
    checks.operationIdentity = adapterSource.includes('operationId');
    checks.mode = ['local-process', 'managed-controller'].includes(candidate.mode);
    checks.workerAuthorityBoundary = typeof candidate.worker_authority_boundary === 'string' && candidate.worker_authority_boundary.length > 0;
    checks.externalEffectBoundary = typeof candidate.external_effect_boundary === 'string' && candidate.external_effect_boundary.length > 0;
    checks.faultInjectionCompatibility = typeof candidate.fault_injection_compatibility === 'string' && candidate.fault_injection_compatibility.length > 0;

    const env = Object.fromEntries((candidate.required_env ?? []).map((name) => [name, Boolean(process.env[name])]));
    checks.requiredEnvDeclared = Array.isArray(candidate.required_env);
    checks.requiredEnvPresent = !checkEnv || Object.values(env).every(Boolean);

    const staticPass = Object.entries(checks)
      .filter(([name]) => name !== 'requiredEnvPresent')
      .every(([, value]) => value === true);

    results.push({
      candidate: candidate.candidate,
      mode: candidate.mode,
      runtimeStatus: candidate.runtime_status,
      blocker: candidate.blocker,
      checks,
      env,
      staticVerdict: staticPass ? 'PASS' : 'FAIL',
      environmentVerdict: checks.requiredEnvPresent ? 'READY' : 'BLOCKED_REQUIRED_ENV'
    });
  }

  return {
    schemaVersion: 1,
    benchmarkToBeat: manifest.decisionState.benchmarkToBeat,
    chassisWinner: manifest.decisionState.chassisWinner,
    results,
    staticVerdict: results.every((result) => result.staticVerdict === 'PASS') ? 'PASS' : 'FAIL'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPreflight().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.staticVerdict === 'PASS' ? 0 : 1;
  }).catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

import net from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i += 2) out.set(argv[i], argv[i + 1]);
  return out;
}

export function packagePath(adapterDir, packageName) {
  const parts = packageName.startsWith('@') ? packageName.split('/') : [packageName];
  return path.join(adapterDir, 'node_modules', ...parts, 'package.json');
}

export async function inspectPackages(adapterDir, expectedPackages) {
  const checks = [];
  for (const [name, expectedVersion] of Object.entries(expectedPackages ?? {})) {
    let actualVersion = null;
    let error = null;
    try {
      const parsed = JSON.parse(await readFile(packagePath(adapterDir, name), 'utf8'));
      actualVersion = parsed.version ?? null;
    } catch (cause) {
      error = cause?.code ?? String(cause);
    }
    checks.push({
      name,
      expectedVersion,
      actualVersion,
      installed: actualVersion !== null,
      exactVersion: actualVersion === expectedVersion,
      error
    });
  }
  return checks;
}

export function inspectNode(allowedNodeMajors, version = process.versions.node) {
  const major = Number(version.split('.')[0]);
  return {
    version,
    major,
    allowedMajors: allowedNodeMajors ?? [],
    pass: (allowedNodeMajors ?? []).includes(major)
  };
}

export function requiredEnvironment(profile, env = process.env) {
  const required = [];
  if (profile.id === 'dbos-ts-v4.27') required.push('DBOS_SYSTEM_DATABASE_URL');
  if (profile.id === 'triggerdev-v4.5.15') required.push('NAIA_TRIGGER_PROJECT_REF', 'TRIGGER_SECRET_KEY');
  return required.map((name) => ({ name, present: typeof env[name] === 'string' && env[name].length > 0 }));
}

function defaultBootstrapTarget(profile, env = process.env) {
  if (profile.id === 'temporal-ts-restricted-v1') {
    const raw = env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
    const index = raw.lastIndexOf(':');
    return { host: raw.slice(0, index), port: Number(raw.slice(index + 1)), source: 'TEMPORAL_ADDRESS' };
  }
  if (profile.id === 'dbos-ts-v4.27' && env.DBOS_SYSTEM_DATABASE_URL) {
    const url = new URL(env.DBOS_SYSTEM_DATABASE_URL);
    return { host: url.hostname, port: Number(url.port || '5432'), source: 'DBOS_SYSTEM_DATABASE_URL' };
  }
  if (profile.id === 'restate-ts-v1') {
    const url = new URL(env.RESTATE_ADMIN_URL ?? 'http://127.0.0.1:9070');
    return { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? '443' : '80')), source: 'RESTATE_ADMIN_URL' };
  }
  return null;
}

export async function tcpReachable(target, timeoutMs = 1500) {
  if (!target) return { attempted: false, reachable: null };
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let settled = false;
    const finish = (reachable, error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ attempted: true, reachable, error });
    };
    socket.setTimeout(timeoutMs, () => finish(false, 'TIMEOUT'));
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(false, error.code ?? String(error)));
  });
}

export async function evaluateProfile(profile, { rootDir, env = process.env, checkBootstrap = true } = {}) {
  const adapterDir = path.resolve(rootDir, path.dirname(profile.adapter));
  const declared = JSON.parse(await readFile(path.join(adapterDir, 'package.json'), 'utf8'));
  const expectedPackages = profile.sdkPackages ?? {};
  const declaredChecks = Object.entries(expectedPackages).map(([name, expectedVersion]) => ({
    name,
    expectedVersion,
    declaredVersion: declared.dependencies?.[name] ?? declared.devDependencies?.[name] ?? null,
    exactVersion: (declared.dependencies?.[name] ?? declared.devDependencies?.[name] ?? null) === expectedVersion
  }));
  const packageChecks = await inspectPackages(adapterDir, expectedPackages);
  const node = inspectNode(profile.runtimePolicy?.allowedNodeMajors ?? []);
  const environment = requiredEnvironment(profile, env);
  const target = defaultBootstrapTarget(profile, env);
  const bootstrap = checkBootstrap ? await tcpReachable(target) : { attempted: false, reachable: null };

  const blockers = [];
  if (!node.pass) blockers.push('NODE_MAJOR_NOT_ALLOWED');
  if (declaredChecks.some((entry) => !entry.exactVersion)) blockers.push('DECLARED_PACKAGE_VERSION_MISMATCH');
  if (packageChecks.some((entry) => !entry.installed)) blockers.push('PACKAGE_NOT_INSTALLED');
  if (packageChecks.some((entry) => entry.installed && !entry.exactVersion)) blockers.push('INSTALLED_PACKAGE_VERSION_MISMATCH');
  if (environment.some((entry) => !entry.present)) blockers.push('REQUIRED_ENVIRONMENT_MISSING');
  if (checkBootstrap && target && bootstrap.reachable !== true) blockers.push('BOOTSTRAP_ENDPOINT_UNREACHABLE');

  return {
    schemaVersion: 1,
    profileId: profile.id,
    candidate: profile.candidate,
    checkedAt: new Date().toISOString(),
    verdict: blockers.length === 0 ? 'READY' : 'BLOCKED',
    blockers,
    node,
    declaredPackages: declaredChecks,
    installedPackages: packageChecks,
    environment,
    bootstrap: { target, ...bootstrap }
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const profileId = args.get('--profile');
  if (!profileId) throw new Error('--profile is required');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(args.get('--root') ?? path.join(here, '..', '..', '..'));
  const profilesPath = path.resolve(rootDir, args.get('--profiles') ?? 'research/chassis/reproduction-profiles.v1.json');
  const profiles = JSON.parse(await readFile(profilesPath, 'utf8'));
  const profile = profiles.profiles.find((entry) => entry.id === profileId);
  if (!profile) throw new Error(`unknown profile: ${profileId}`);
  const result = await evaluateProfile(profile, {
    rootDir,
    env: process.env,
    checkBootstrap: args.get('--skip-bootstrap') !== '1'
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.verdict === 'READY' ? 0 : 2;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}

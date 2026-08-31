import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessBenchmarkExecutionReadiness } from './benchmark-execution-readiness.mjs';

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function benchmarkReadiness(repositoryRoot) {
  const chassisRoot = path.join(repositoryRoot, 'research', 'chassis');
  const [protocol, criticalPlan] = await Promise.all([
    readJson(path.join(chassisRoot, 'experiment-protocol.v1.json')),
    readJson(path.join(chassisRoot, 'critical-mutant-plan.v1.json'))
  ]);
  return assessBenchmarkExecutionReadiness(protocol, criticalPlan);
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(process.argv[2] ?? path.join(here, '..', '..', '..'));
  const result = await benchmarkReadiness(repositoryRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ready ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 3;
  });
}

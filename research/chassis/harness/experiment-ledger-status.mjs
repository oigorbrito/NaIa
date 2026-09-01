import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessStoredFormalLedgerCurrentCompatibility,
  assessStoredFormalLedgerEnvironmentConsistency,
  assessStoredFormalLedgerHarnessConsistency,
  assessStoredFormalLedgerRepositoryRevisionConsistency,
  auditStoredFormalLedger,
  validateExecutionLedger
} from './experiment-ledger-validator.mjs';

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i += 2) out.set(argv[i], argv[i + 1]);
  return out;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function recordsFromLedger(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  throw new Error('ledger file must be an array or an object with records[]');
}

export async function ledgerStatus({ repositoryRoot, ledgerPath = null }) {
  const chassisRoot = path.join(repositoryRoot, 'research', 'chassis');
  const [protocol, faultSuite] = await Promise.all([
    readJson(path.join(chassisRoot, 'experiment-protocol.v1.json')),
    readJson(path.join(chassisRoot, 'fault-suite.v1.json'))
  ]);
  const records = ledgerPath ? recordsFromLedger(await readJson(ledgerPath)) : [];
  const structural = validateExecutionLedger(records, protocol, faultSuite, { allowPrefix: true });
  const formalAudit = auditStoredFormalLedger(records);
  const currentCompatibility = assessStoredFormalLedgerCurrentCompatibility(records);
  const repositoryRevisionConsistency = assessStoredFormalLedgerRepositoryRevisionConsistency(records);
  const harnessConsistency = assessStoredFormalLedgerHarnessConsistency(records);
  const environmentConsistency = assessStoredFormalLedgerEnvironmentConsistency(records);
  const historicallyValid = structural.valid && formalAudit.valid;
  const validForAppend = historicallyValid &&
    currentCompatibility.compatible &&
    repositoryRevisionConsistency.consistent &&
    harnessConsistency.consistent &&
    environmentConsistency.consistent;
  return {
    ...structural,
    valid: validForAppend,
    complete: structural.complete && validForAppend,
    historicallyValid,
    validForAppend,
    formalAudit,
    currentCompatibility,
    repositoryRevisionConsistency,
    harnessConsistency,
    environmentConsistency
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(args.get('--repository-root') ?? path.join(here, '..', '..', '..'));
  const ledgerPath = args.get('--ledger') ? path.resolve(args.get('--ledger')) : null;
  const result = await ledgerStatus({ repositoryRoot, ledgerPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.validForAppend ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 3;
  });
}

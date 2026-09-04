#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createFilePorts } from './file-ports.mjs';
import { createNaiaService } from './service.mjs';
import { createAutomationTriggerRuntime, createFileAutomationRunStore } from './trigger-runtime.mjs';
import { createOperationalControlPlane } from './control-plane-runtime.mjs';

export async function runControlPlaneCommand({ controlPlane, command = 'health', args = [] } = {}) {
  if (!controlPlane?.operations || !controlPlane?.reconciler || !controlPlane?.subscriptions) throw new Error('operational control plane is required');
  const { operations, reconciler, subscriptions } = controlPlane;
  if (command === 'health') {
    const local = await operations.health();
    const remote = await reconciler.reconcile();
    return { healthy: local.healthy && remote.healthy, local, remote, schedulerConfigured: controlPlane.schedulerConfigured, clients: controlPlane.clients };
  }
  if (command === 'reconcile') return reconciler.reconcile();
  if (command === 'repair') return reconciler.repair(await reconciler.reconcile());
  if (command === 'renew') return operations.renewExpiring();
  if (command === 'sync') return operations.syncScheduler();
  if (command === 'maintenance') return operations.runMaintenance({ repair: !args.includes('--no-repair') });
  if (command === 'history') {
    const raw = args[0];
    const limit = raw == null ? 50 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1) throw new Error('history limit must be a positive integer');
    return operations.history({ limit });
  }
  if (command === 'subscriptions') return subscriptions.list();
  throw new Error(`unknown control-plane command: ${command}`);
}

async function main() {
  const [command = 'health', ...args] = process.argv.slice(2);
  const rootDir = process.env.NAIA_DATA_DIR || '.naia';
  const ports = createFilePorts({ rootDir });
  const naia = createNaiaService(ports);
  const triggerRuntime = createAutomationTriggerRuntime({ naia, runs: createFileAutomationRunStore({ rootDir }) });
  const controlPlane = createOperationalControlPlane({ rootDir, naia, triggerRuntime });
  const result = await runControlPlaneCommand({ controlPlane, command, args });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error?.message ?? String(error)); process.exitCode = 2; });
}

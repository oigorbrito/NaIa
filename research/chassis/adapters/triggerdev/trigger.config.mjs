import { defineConfig } from '@trigger.dev/sdk';

const project = process.env.NAIA_TRIGGER_PROJECT_REF;
if (!project) throw new Error('NAIA_TRIGGER_PROJECT_REF is required');

export default defineConfig({
  project,
  dirs: ['./trigger'],
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 1,
      minTimeoutInMs: 500,
      maxTimeoutInMs: 500,
      randomize: false
    }
  }
});

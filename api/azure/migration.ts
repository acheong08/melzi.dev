import { app } from '@azure/functions';
import { createMigrationHandler } from './migration-adapter.js';
if (process.env.CLOUD_PROVIDER !== 'azure') throw new Error('Azure provider configuration required');
// Temporary separate app only. Platform function-key authorization happens
// before this handler; never embed its key or admin DB password in the frontend.
app.http('researchMigration', { methods: ['POST'], route: 'migrate', authLevel: 'function', handler: createMigrationHandler() });

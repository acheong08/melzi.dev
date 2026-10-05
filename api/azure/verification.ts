import { app } from '@azure/functions';
import { createVerificationHandler } from './verification-adapter.js';
if (process.env.CLOUD_PROVIDER !== 'azure') throw new Error('Azure provider configuration required');
// Temporary, platform function-key-authenticated QA app; never deploy alongside
// the anonymous API or distribute its host/function key to frontend clients.
app.http('researchVerification', { methods: ['POST'], route: 'verify', authLevel: 'function', handler: createVerificationHandler() });

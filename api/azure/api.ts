import { app } from '@azure/functions';
import { createAzureHttpHandler } from './http-adapter.js';
if (process.env.CLOUD_PROVIDER !== 'azure') throw new Error('Azure provider configuration required');
app.http('researchDraft', {
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'], route: 'v1/draft', authLevel: 'anonymous',
  handler: createAzureHttpHandler()
});

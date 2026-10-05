import { app } from '@azure/functions';
import { createHousekeeping } from '../backend/housekeeping.js';
import { database } from '../backend/database.js';
if (process.env.CLOUD_PROVIDER !== 'azure') throw new Error('Azure provider configuration required');
const housekeeping = createHousekeeping({ provider: 'azure', getPool: async () => {
  if (process.env.PGUSER !== 'melzi_research_app') throw new Error('Restricted database role required');
  return database();
} });
// No HTTP registration. Azure Timer invokes this trusted adapter in UTC.
app.timer('researchHousekeeping', {
  schedule: '0 0 * * * *', runOnStartup: false, useMonitor: true,
  handler: async () => {
    const result = await housekeeping.handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' });
    if (!result.ok) throw new Error('Research housekeeping requires manual recovery');
  }
});

import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { azureDatabaseSecret } from '../backend/database.js';
import { migrateDatabase } from '../backend/migrate.js';
import { readBody } from './http-adapter.js';
export function createMigrationHandler(dependencies: {
  env?: () => NodeJS.ProcessEnv;
  migrate?: typeof migrateDatabase;
} = {}) {
  return async (request: HttpRequest): Promise<HttpResponseInit> => {
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    try {
      if (request.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return { status: 400, headers, jsonBody: { ok: false, error: 'invalid_migration_request' } };
      let event: unknown;
      try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 1024))); }
      catch { return { status: 400, headers, jsonBody: { ok: false, error: 'invalid_migration_request' } }; }
      if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).length !== 1 || (event as { action?: string }).action !== 'migrate') return { status: 400, headers, jsonBody: { ok: false, error: 'invalid_migration_request' } };
      const env = dependencies.env?.() ?? process.env;
      const master = azureDatabaseSecret(env);
      const password = env.PG_APP_PASSWORD;
      if (master.username === 'melzi_research_app' || !password || password.includes('\0') || password.length > 4096 ||
          (env.PG_APP_USER !== undefined && env.PG_APP_USER !== 'melzi_research_app')) throw new Error('Invalid migration role configuration');
      const result = await (dependencies.migrate ?? migrateDatabase)(master, { ...master, username: 'melzi_research_app', password });
      return { status: 200, headers, jsonBody: result };
    } catch {
      return { status: 503, headers, jsonBody: { ok: false, error: 'migration_failed' } };
    }
  };
}

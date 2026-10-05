import { DeleteFunctionConcurrencyCommand, LambdaClient, PutFunctionConcurrencyCommand } from '@aws-sdk/client-lambda';
import type { Pool, PoolClient } from 'pg';
import { database } from './database.js';
import { CIRCUIT_BREAKER_LOCK, UTC_DAY_SQL } from './admission.js';
import { cloudProvider, type CloudProvider } from './provider.js';
import { armTarget, createAzureControl, type AppControl } from './azure-control.js';

/**
 * Private EventBridge-only function, separate from the public API and its stop.
 * Env: API_FUNCTION_NAME (the public API, never this function), DB_SECRET_ARN,
 * AWS_REGION, plus bundled rds-ca.pem required by database.ts.
 * IAM: app-secret read/networking/logging, and DeleteFunctionConcurrency plus
 * PutFunctionConcurrency on the exact API ARN (Put repairs ambiguous reopen).
 *
 * Only quota-marked prior days may reopen. Markers are cleared and committed
 * BEFORE calling AWS. Failed/ambiguous recovery is deliberately not retried
 * automatically; it needs operator diagnosis. For manual emergency stops,
 * disable this EventBridge schedule first, as documented in the runbook.
 */
interface ControlPlane {
  send(command: DeleteFunctionConcurrencyCommand | PutFunctionConcurrencyCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}
interface Dependencies {
  provider?: CloudProvider;
  appControl?: AppControl;
  getPool?: () => Promise<Pool>;
  control?: ControlPlane;
  functionName?: () => string | undefined;
  log?: (message: string) => void;
}
type Event = { source?: string; 'detail-type'?: string };
type Reopen = 'not_needed' | 'reopened' | 'busy' | 'current_day_closed' | 'manual_recovery_required';

export function createHousekeeping(dependencies: Dependencies = {}) {
  const provider = dependencies.provider ?? cloudProvider();
  const appControl = dependencies.appControl ?? createAzureControl();
  const sdk = new LambdaClient({
    region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 1,
    requestHandler: { connectionTimeout: 500, requestTimeout: 1_000 }
  });
  const control: ControlPlane = dependencies.control ?? { send: (command, options) => command instanceof PutFunctionConcurrencyCommand ? sdk.send(command, options) : sdk.send(command, options) };
  const getPool = dependencies.getPool ?? database;
  const functionName = dependencies.functionName ?? (() => process.env.API_FUNCTION_NAME);
  const log = dependencies.log ?? ((message: string) => console.error(message));

  async function reopenQuotaStop(pool: Pool): Promise<Reopen> {
    const name = functionName();
    if (provider === 'aws' && (!name || !/^[a-zA-Z0-9-_]{1,64}$/.test(name) || name === process.env.AWS_LAMBDA_FUNCTION_NAME)) throw new Error('Invalid housekeeping target');
    if (provider === 'azure' && !dependencies.appControl) armTarget(process.env);
    const connection: PoolClient = await pool.connect();
    let acquired = false;
    let transaction = false;
    let destroyConnection = false;
    try {
      // Bound session lock lifetime if Lambda crashes/freezes during AWS I/O.
      await connection.query("SET idle_session_timeout = '5000ms'");
      const lock = await connection.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [CIRCUIT_BREAKER_LOCK]);
      acquired = lock.rows[0]?.acquired === true;
      if (!acquired) return 'busy';
      await connection.query('BEGIN');
      transaction = true;
      const current = await connection.query(`SELECT 1 FROM melzi_research.daily_budget
        WHERE day = ${UTC_DAY_SQL} AND (auto_closed = true OR requests >= 10000)`);
      if (current.rowCount) {
        await connection.query('COMMIT');
        transaction = false;
        return 'current_day_closed';
      }
      const cleared = await connection.query(`UPDATE melzi_research.daily_budget
        SET auto_closed = false
        WHERE day < ${UTC_DAY_SQL} AND auto_closed = true
        RETURNING day`);
      await connection.query('COMMIT');
      transaction = false;
      if (!cleared.rowCount) return 'not_needed';
      try {
        // Keep the SESSION advisory lock across this post-commit AWS call, so
        // quota-closing transactions cannot race this reopening operation.
        if (provider === 'azure') await appControl.start();
        else await control.send(new DeleteFunctionConcurrencyCommand({ FunctionName: name }), { abortSignal: AbortSignal.timeout(1_200) });
        log('research_api_reopened_after_daily_quota');
        return 'reopened';
      } catch {
        // A timeout may have applied the delete. Restore zero best effort and
        // retain no retry marker, avoiding unintended hourly auto-reopening.
        try {
          if (provider === 'azure') await appControl.stop();
          else await control.send(new PutFunctionConcurrencyCommand({ FunctionName: name, ReservedConcurrentExecutions: 0 }), { abortSignal: AbortSignal.timeout(1_200) });
          log('research_api_reopen_failed_stopped_for_manual_recovery');
        } catch {
          log('research_api_reopen_and_restop_failed_manual_recovery_required');
        }
        return 'manual_recovery_required';
      }
    } catch {
      if (transaction) await connection.query('ROLLBACK').catch(() => { destroyConnection = true; });
      // Never reopen after an uncertain DB marker write/commit.
      log('research_housekeeping_reopen_database_failed');
      return 'manual_recovery_required';
    } finally {
      try {
        if (acquired) {
          const unlocked = await connection.query<{ unlocked: boolean }>('SELECT pg_advisory_unlock($1::bigint) AS unlocked', [CIRCUIT_BREAKER_LOCK]);
          if (unlocked.rows[0]?.unlocked !== true) destroyConnection = true;
        }
        await connection.query('RESET idle_session_timeout');
      } catch { destroyConnection = true; }
      // Never return a connection with an uncertain session advisory lock.
      connection.release(destroyConnection ? new Error('Housekeeping connection reset required') : undefined);
    }
  }

  async function handler(event: Event) {
    if (event.source !== 'aws.events' || event['detail-type'] !== 'Scheduled Event') throw new Error('Unsupported housekeeping event');
    try {
      const pool = await getPool();
      // One statement is one transaction: tombstones and deletion cannot split.
      const expired = await pool.query(`WITH expired AS (
          SELECT token_hash FROM melzi_research.drafts
          WHERE expires_at < now() LIMIT 100 FOR UPDATE SKIP LOCKED
        ), retired AS (
          INSERT INTO melzi_research.retired_sessions(token_hash)
          SELECT token_hash FROM expired ON CONFLICT DO NOTHING
        )
        DELETE FROM melzi_research.drafts WHERE token_hash IN (SELECT token_hash FROM expired)`);
      const receipts = await pool.query(`DELETE FROM melzi_research.receipts WHERE ctid IN (
        SELECT ctid FROM melzi_research.receipts
        WHERE created_at < now() - interval '7 days' LIMIT 1000
      )`);
      const budgets = await pool.query(`DELETE FROM melzi_research.daily_budget WHERE day IN (
        SELECT day FROM melzi_research.daily_budget
        WHERE day < ${UTC_DAY_SQL} - 7 AND auto_closed = false LIMIT 100
      )`);
      const reopen = await reopenQuotaStop(pool);
      return {
        ok: reopen !== 'manual_recovery_required',
        expiredDraftsDeleted: expired.rowCount ?? 0,
        receiptsDeleted: receipts.rowCount ?? 0,
        budgetsDeleted: budgets.rowCount ?? 0,
        reopen
      };
    } catch {
      log('research_housekeeping_dependency_failed');
      // Sanitized error only: EventBridge/Lambda can retry the private task.
      throw new Error('Research housekeeping unavailable');
    }
  }
  return { handler };
}
export const handler = createHousekeeping().handler;

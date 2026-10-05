import { LambdaClient, PutFunctionConcurrencyCommand } from '@aws-sdk/client-lambda';
import type { Pool, PoolClient } from 'pg';
import { ApiFailure } from './validation.js';
import { cloudProvider, type CloudProvider } from './provider.js';
import { createAzureControl, type AppControl } from './azure-control.js';

/**
 * Counts every supported API invocation, not just successful writes. Call once
 * after routing and before credential/body validation or private DB reads.
 * The autocommitted reservation must NOT be part of the draft-write transaction.
 *
 * Requires daily_budget.requests integer NOT NULL DEFAULT 0 and
 * daily_budget.auto_closed boolean NOT NULL DEFAULT false. The API role needs
 * lambda:PutFunctionConcurrency on its own exact function ARN only.
 *
 * Setting concurrency to zero is a circuit breaker: in-flight invocations and
 * control-plane propagation still exist, so this is not a hard AWS spending cap.
 */
export const DAILY_INVOCATION_LIMIT = 10_000;
export const CIRCUIT_BREAKER_LOCK = '4728994653852';

// Evaluated by PostgreSQL, not by the Lambda host's local date/time.
export const UTC_DAY_SQL = "(now() AT TIME ZONE 'UTC')::date";
const RETRY_AFTER_SQL = `GREATEST(1, CEIL(EXTRACT(EPOCH FROM
  (((${UTC_DAY_SQL} + 1)::timestamp AT TIME ZONE 'UTC') - now()))))::integer`;

interface ControlPlane {
  send(command: PutFunctionConcurrencyCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}
interface Dependencies {
  provider?: CloudProvider;
  appControl?: AppControl;
  control?: ControlPlane;
  functionName?: () => string | undefined;
  log?: (message: string) => void;
}
interface BudgetRow { day: string; requests: number; retry_after: number }

export function createAdmission(dependencies: Dependencies = {}) {
  const provider = dependencies.provider ?? cloudProvider();
  const appControl = dependencies.appControl ?? createAzureControl();
  const client = new LambdaClient({
    region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 1,
    requestHandler: { connectionTimeout: 500, requestTimeout: 1_000 }
  });
  const control: ControlPlane = dependencies.control ?? { send: (command, options) => client.send(command, options) };
  const functionName = dependencies.functionName ?? (() => process.env.AWS_LAMBDA_FUNCTION_NAME);
  const log = dependencies.log ?? ((message: string) => console.error(message));
  let dependencyStop: Promise<boolean> | undefined;

  async function setStopped(): Promise<void> {
    if (provider === 'azure') return appControl.stop();
    const name = functionName();
    if (!name || !/^[a-zA-Z0-9-_]{1,64}$/.test(name)) throw new Error('Missing circuit breaker target');
    await control.send(new PutFunctionConcurrencyCommand({ FunctionName: name, ReservedConcurrentExecutions: 0 }), { abortSignal: AbortSignal.timeout(1_200) });
  }

  async function closeAzureQuota(pool: Pool, day: string): Promise<void> {
    let connection: PoolClient | undefined;
    let acquired = false, transaction = false, destroy = false;
    try {
      connection = await pool.connect();
      await connection.query("SET idle_session_timeout = '5000ms'");
      acquired = (await connection.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [CIRCUIT_BREAKER_LOCK])).rows[0]?.acquired === true;
      if (!acquired) return;
      await connection.query('BEGIN'); transaction = true;
      // Deliberately includes already-closed rows: a failed ARM stop must be
      // retried by later exhausted invocations, not suppressed by its marker.
      const marked = await connection.query(`UPDATE melzi_research.daily_budget SET auto_closed = true
        WHERE day = $1::date AND requests >= $2 RETURNING day`, [day, DAILY_INVOCATION_LIMIT]);
      await connection.query('COMMIT'); transaction = false;
      if (!marked.rowCount) return;
      // Azure Stop can kill THIS worker. Persist the marker first, retaining
      // only the bounded session latch across control I/O to serialize reopen.
      await setStopped();
      log('research_api_stopped_daily_quota');
    } catch {
      if (transaction) await connection?.query('ROLLBACK').catch(() => { destroy = true; });
      log('research_api_daily_quota_stop_failed');
    } finally {
      if (connection) {
        try {
          if (acquired && (await connection.query<{ unlocked: boolean }>('SELECT pg_advisory_unlock($1::bigint) AS unlocked', [CIRCUIT_BREAKER_LOCK])).rows[0]?.unlocked !== true) destroy = true;
          await connection.query('RESET idle_session_timeout');
        } catch { destroy = true; }
        connection.release(destroy ? new Error('Admission connection reset required') : undefined);
      }
    }
  }

  async function closeForQuota(pool: Pool, day: string): Promise<void> {
    if (provider === 'azure') return closeAzureQuota(pool, day);
    let connection: PoolClient | undefined;
    let destroyConnection = false;
    try {
      connection = await pool.connect();
      await connection.query('BEGIN');
      // Transaction-scoped: crashes/timeouts release the latch automatically.
      // A failed AWS call rolls the marker back so a later invocation can retry.
      const lock = await connection.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired', [CIRCUIT_BREAKER_LOCK]);
      if (lock.rows[0]?.acquired !== true) {
        await connection.query('ROLLBACK');
        return;
      }
      const marked = await connection.query(`UPDATE melzi_research.daily_budget
        SET auto_closed = true
        WHERE day = $1::date AND requests >= $2 AND auto_closed = false
        RETURNING day`, [day, DAILY_INVOCATION_LIMIT]);
      if (!marked.rowCount) {
        await connection.query('COMMIT');
        return;
      }
      await setStopped();
      await connection.query('COMMIT');
      log('research_api_stopped_daily_quota');
    } catch {
      await connection?.query('ROLLBACK').catch(() => { destroyConnection = true; });
      // If AWS applied an operation whose acknowledgement was lost, the marker
      // may remain false. That safely requires manual diagnosis/reopening.
      log('research_api_daily_quota_stop_failed');
    } finally {
      connection?.release(destroyConnection ? new Error('Admission connection reset required') : undefined);
    }
  }

  async function reserveInvocation(pool: Pool): Promise<void> {
    if (provider === 'azure') {
      // Separate, uncapped entry counter lets private QA distinguish an ARM
      // stopped app from a still-executing app that merely returns quota 429s.
      await pool.query(`INSERT INTO melzi_research.daily_budget(day,requests,writes,creates,auto_closed,observed_invocations)
        VALUES (${UTC_DAY_SQL},0,0,0,false,1) ON CONFLICT(day) DO UPDATE
        SET observed_invocations=melzi_research.daily_budget.observed_invocations+1`);
    }
    const result = await pool.query<BudgetRow>(`INSERT INTO melzi_research.daily_budget
      (day, requests, writes, creates, auto_closed)
      VALUES (${UTC_DAY_SQL}, 1, 0, 0, false)
      ON CONFLICT(day) DO UPDATE
        SET requests = melzi_research.daily_budget.requests + 1
        WHERE melzi_research.daily_budget.requests < $1
          AND melzi_research.daily_budget.auto_closed = false
      RETURNING day::text AS day, requests, ${RETRY_AFTER_SQL} AS retry_after`, [DAILY_INVOCATION_LIMIT]);
    const admitted = result.rows[0];
    if (admitted) {
      if (!Number.isInteger(admitted.requests) || admitted.requests < 1 || admitted.requests > DAILY_INVOCATION_LIMIT) throw new Error('Invalid admission result');
      if (admitted.requests === DAILY_INVOCATION_LIMIT) {
        await closeForQuota(pool, admitted.day);
        if (provider === 'azure') throw new ApiFailure(429, 'daily_limit', 'Saving has reached its daily limit. Please try again after the reset.', undefined, admitted.retry_after);
      }
      // AWS preserves the current invocation. Azure's cutoff request stays pending
      // on the client and must not begin a write after stopping its own worker.
      return;
    }
    const clock = await pool.query<{ day: string; retry_after: number }>(`SELECT ${UTC_DAY_SQL}::text AS day, ${RETRY_AFTER_SQL} AS retry_after`);
    const current = clock.rows[0];
    if (!current || typeof current.day !== 'string' || !Number.isInteger(current.retry_after) || current.retry_after < 1 || current.retry_after > 86_400) throw new Error('Invalid admission clock');
    await closeForQuota(pool, current.day);
    throw new ApiFailure(429, 'daily_limit', 'Saving has reached its daily limit. Please try again after the reset.', undefined, current.retry_after);
  }

  /**
   * Best-effort emergency stop for unexpected database/dependency failures.
   * Never sets auto_closed: this stop is NOT eligible for routine reopening.
   * Operational procedure: disable the housekeeping schedule for any manual
   * shutdown, diagnose, then explicitly restore unreserved concurrency.
   */
  async function stopOnDependencyFailure(): Promise<boolean> {
    if (dependencyStop) return dependencyStop;
    dependencyStop = (async () => {
      try {
        await setStopped();
        log('research_api_stopped_dependency_failure');
        return true;
      } catch {
        log('research_api_dependency_stop_failed');
        return false;
      }
    })();
    try { return await dependencyStop; }
    finally { dependencyStop = undefined; }
  }

  return { reserveInvocation, stopOnDependencyFailure };
}
const admission = createAdmission();
export const reserveInvocation = admission.reserveInvocation;
export const stopOnDependencyFailure = admission.stopOnDependencyFailure;

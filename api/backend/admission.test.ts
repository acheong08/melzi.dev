// Isolated unit tests only: bun test ./backend/admission.test.ts
// PostgreSQL and Lambda control-plane calls are injected; no network or secrets.
import { describe, expect, test } from 'bun:test';
import { DeleteFunctionConcurrencyCommand, PutFunctionConcurrencyCommand } from '@aws-sdk/client-lambda';
import type { Pool } from 'pg';
import { createAdmission, DAILY_INVOCATION_LIMIT } from './admission.ts';
import { createHousekeeping } from './housekeeping.ts';
import { ApiFailure } from './validation.ts';

const DAY = '2026-10-02';
const EVENT = { source: 'aws.events', 'detail-type': 'Scheduled Event' };
function fakeDatabase(options: { requests?: number; closed?: boolean; priorClosed?: boolean; busy?: boolean; failCommit?: boolean; failBudget?: boolean; failUnlock?: boolean } = {}) {
  const events: string[] = [];
  const queries: string[] = [];
  const state = { requests: options.requests ?? 0, closed: options.closed ?? false, priorClosed: options.priorClosed ?? false, writes: 12, creates: 3, lock: options.busy ? -1 : 0, releasedDestroyed: false };
  let id = 0;
  const result = (rows: unknown[] = [], rowCount = rows.length) => ({ rows, rowCount });
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      queries.push(sql);
      if (sql.includes('INSERT INTO melzi_research.daily_budget')) {
        events.push('reserve');
        if (options.failBudget) throw new Error('private database diagnostic');
        expect(values).toEqual([DAILY_INVOCATION_LIMIT]);
        expect(sql).toContain("(now() AT TIME ZONE 'UTC')::date");
        if (state.requests >= DAILY_INVOCATION_LIMIT || state.closed) return result();
        state.requests++;
        return result([{ day: DAY, requests: state.requests, retry_after: 3600 }]);
      }
      if (sql.startsWith('SELECT ') && sql.includes('AS retry_after')) return result([{ day: DAY, retry_after: 3600 }]);
      if (sql.includes('WITH expired AS')) { events.push('retire-and-delete'); return result([], 2); }
      if (sql.startsWith('DELETE FROM melzi_research.receipts')) { events.push('delete-receipts'); return result([], 4); }
      if (sql.startsWith('DELETE FROM melzi_research.daily_budget')) { events.push('delete-old-budgets'); return result([], 1); }
      throw new Error('Unexpected pool query');
    },
    async connect() {
      const connectionId = ++id;
      let transaction = false;
      let sessionLock = false;
      let pendingClosed: boolean | undefined;
      let pendingPriorClosed: boolean | undefined;
      return {
        async query(sql: string, _values: unknown[] = []) {
          queries.push(sql);
          if (sql === 'BEGIN') { transaction = true; events.push('begin'); return result(); }
          if (sql === 'COMMIT') {
            events.push('commit');
            if (options.failCommit) throw new Error('private commit diagnostic');
            if (pendingClosed !== undefined) state.closed = pendingClosed;
            if (pendingPriorClosed !== undefined) state.priorClosed = pendingPriorClosed;
            transaction = false; pendingClosed = undefined; pendingPriorClosed = undefined;
            if (!sessionLock && state.lock === connectionId) state.lock = 0;
            return result();
          }
          if (sql === 'ROLLBACK') {
            events.push('rollback'); transaction = false; pendingClosed = undefined; pendingPriorClosed = undefined;
            if (!sessionLock && state.lock === connectionId) state.lock = 0;
            return result();
          }
          if (sql.includes('pg_try_advisory_xact_lock') || sql.includes('pg_try_advisory_lock')) {
            const acquired = state.lock === 0 || state.lock === connectionId;
            if (acquired) { state.lock = connectionId; sessionLock = !sql.includes('_xact_'); }
            events.push(acquired ? 'lock' : 'lock-busy');
            return result([{ acquired }]);
          }
          if (sql.includes('pg_advisory_unlock')) {
            events.push('unlock');
            if (options.failUnlock) throw new Error('private unlock diagnostic');
            const unlocked = state.lock === connectionId;
            if (unlocked) state.lock = 0;
            sessionLock = false;
            return result([{ unlocked }]);
          }
          if (sql.includes('SET auto_closed = true')) {
            events.push('mark-closed');
            if (state.closed || state.requests < DAILY_INVOCATION_LIMIT) return result();
            expect(transaction).toBe(true);
            pendingClosed = true;
            return result([{ day: DAY }]);
          }
          if (sql.startsWith('SELECT 1 FROM melzi_research.daily_budget')) {
            events.push('check-current-day');
            return state.closed || state.requests >= DAILY_INVOCATION_LIMIT ? result([{ '?column?': 1 }]) : result();
          }
          if (sql.includes('SET auto_closed = false')) {
            events.push('clear-prior-markers');
            if (!state.priorClosed) return result();
            expect(transaction).toBe(true);
            pendingPriorClosed = false;
            return result([{ day: '2026-10-01' }]);
          }
          if (sql.startsWith('SET idle_session_timeout') || sql === 'RESET idle_session_timeout') return result();
          throw new Error('Unexpected client query');
        },
        release(error?: Error) {
          events.push('release');
          if (error) { state.releasedDestroyed = true; if (state.lock === connectionId) state.lock = 0; }
        }
      };
    }
  } as unknown as Pool;
  return { pool, state, events, queries };
}
function admissionFor(db: ReturnType<typeof fakeDatabase>, behavior: (call: number) => Promise<void> = async () => {}) {
  const calls: PutFunctionConcurrencyCommand[] = [];
  const logs: string[] = [];
  const admission = createAdmission({
    functionName: () => 'melzi-research-api', log: line => logs.push(line),
    control: { async send(command, options) {
      expect(command).toBeInstanceOf(PutFunctionConcurrencyCommand);
      expect(command.input).toEqual({ FunctionName: 'melzi-research-api', ReservedConcurrentExecutions: 0 });
      expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
      calls.push(command); db.events.push('aws-stop'); await behavior(calls.length);
      return {};
    } }
  });
  return { ...admission, calls, logs };
}
function housekeepingFor(db: ReturnType<typeof fakeDatabase>, behavior: (command: DeleteFunctionConcurrencyCommand | PutFunctionConcurrencyCommand) => Promise<void> = async () => {}) {
  const calls: (DeleteFunctionConcurrencyCommand | PutFunctionConcurrencyCommand)[] = [];
  const logs: string[] = [];
  const housekeeping = createHousekeeping({
    getPool: async () => db.pool, functionName: () => 'melzi-research-api', log: line => logs.push(line),
    control: { async send(command, options) {
      expect(command.input.FunctionName).toBe('melzi-research-api');
      expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
      calls.push(command);
      db.events.push(command instanceof DeleteFunctionConcurrencyCommand ? 'aws-reopen' : 'aws-restop');
      expect(db.state.priorClosed).toBe(false); // Preclear is committed first.
      expect(db.state.lock).not.toBe(0); // Session lock survives that commit.
      await behavior(command);
      return {};
    } }
  });
  return { ...housekeeping, calls, logs };
}

describe('all-invocation admission and quota shutdown', () => {
  test('normal admission changes only requests, not write/create counters', async () => {
    const db = fakeDatabase(); const gate = admissionFor(db);
    await gate.reserveInvocation(db.pool);
    expect(db.state).toMatchObject({ requests: 1, writes: 12, creates: 3, closed: false });
    expect(db.events).toEqual(['reserve']);
    expect(gate.calls).toHaveLength(0);
  });
  test('the 10000th admission can finish after marking and stopping future execution', async () => {
    const db = fakeDatabase({ requests: 9999 }); const gate = admissionFor(db);
    await gate.reserveInvocation(db.pool);
    expect(db.state).toMatchObject({ requests: 10000, closed: true, lock: 0 });
    expect(db.events).toEqual(['reserve', 'begin', 'lock', 'mark-closed', 'aws-stop', 'commit', 'release']);
    expect(gate.calls).toHaveLength(1);
  });
  test('exhausted requests throw 429 with database-derived UTC Retry-After', async () => {
    const db = fakeDatabase({ requests: 10000, closed: true }); const gate = admissionFor(db);
    let error: unknown; try { await gate.reserveInvocation(db.pool); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ApiFailure);
    expect(error).toMatchObject({ status: 429, code: 'daily_limit', retryAfter: 3600 });
    expect(db.state.requests).toBe(10000);
    expect(gate.calls).toHaveLength(0);
  });
  test('a failed AWS stop rolls back its marker, allowing a later request to retry', async () => {
    const db = fakeDatabase({ requests: 9999 });
    const gate = admissionFor(db, async call => { if (call === 1) throw new Error('private AWS diagnostic'); });
    await gate.reserveInvocation(db.pool);
    expect(db.state.closed).toBe(false);
    expect(db.events).toContain('rollback');
    await expect(gate.reserveInvocation(db.pool)).rejects.toMatchObject({ status: 429 });
    expect(db.state.closed).toBe(true);
    expect(gate.calls).toHaveLength(2);
    expect(gate.logs.join(' ')).not.toContain('private');
  });
  test('a busy close/reopen lock avoids control-plane update storms', async () => {
    const db = fakeDatabase({ requests: 9999, busy: true }); const gate = admissionFor(db);
    await gate.reserveInvocation(db.pool);
    expect(db.state.closed).toBe(false);
    expect(gate.calls).toHaveLength(0);
    expect(db.events).toContain('rollback');
  });
  test('concurrent admitted requests never increment the counter beyond the threshold', async () => {
    const db = fakeDatabase({ requests: 9995 }); const gate = admissionFor(db);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => gate.reserveInvocation(db.pool)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(15);
    expect(db.state.requests).toBe(10000);
    expect(gate.calls).toHaveLength(1);
  });
  test('DB failure propagates for handler emergency-stop integration', async () => {
    const db = fakeDatabase({ failBudget: true }); const gate = admissionFor(db);
    await expect(gate.reserveInvocation(db.pool)).rejects.toThrow();
    expect(gate.calls).toHaveLength(0);
  });
  test('uncertain commit does not leave a committed automatic-reopen marker in the model', async () => {
    const db = fakeDatabase({ requests: 9999, failCommit: true }); const gate = admissionFor(db);
    await gate.reserveInvocation(db.pool);
    expect(gate.calls).toHaveLength(1);
    expect(db.state.closed).toBe(false);
    expect(gate.logs).toContain('research_api_daily_quota_stop_failed');
  });
  test('emergency dependency stop never touches database auto-reopen markers', async () => {
    const db = fakeDatabase(); const gate = admissionFor(db);
    expect(await gate.stopOnDependencyFailure()).toBe(true);
    expect(db.state.closed).toBe(false);
    expect(db.queries).toEqual([]);
    expect(gate.logs).toEqual(['research_api_stopped_dependency_failure']);
  });
  test('emergency stop errors are sanitized and returned instead of thrown', async () => {
    const db = fakeDatabase(); const gate = admissionFor(db, async () => { throw new Error('private error/credentials'); });
    expect(await gate.stopOnDependencyFailure()).toBe(false);
    expect(gate.logs).toEqual(['research_api_dependency_stop_failed']);
  });
  test('concurrent emergency stop calls share one in-flight AWS operation', async () => {
    const db = fakeDatabase();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const gate = admissionFor(db, async () => pending);
    const one = gate.stopOnDependencyFailure(); const two = gate.stopOnDependencyFailure();
    expect(gate.calls).toHaveLength(1);
    release();
    expect(await Promise.all([one, two])).toEqual([true, true]);
  });
});

describe('private housekeeping retention and reopening', () => {
  test('invalid events cannot touch DB or control plane', async () => {
    const db = fakeDatabase(); const task = housekeepingFor(db);
    await expect(task.handler({})).rejects.toThrow('Unsupported housekeeping event');
    expect(db.events).toEqual([]);
    expect(task.calls).toHaveLength(0);
  });
  test('retention is bounded, tombstones atomic, and unmarked stops never reopen', async () => {
    const db = fakeDatabase(); const task = housekeepingFor(db);
    const result = await task.handler(EVENT);
    expect(result).toEqual({ ok: true, expiredDraftsDeleted: 2, receiptsDeleted: 4, budgetsDeleted: 1, reopen: 'not_needed' });
    expect(task.calls).toHaveLength(0);
    expect(db.queries[0]).toContain('INSERT INTO melzi_research.retired_sessions');
    expect(db.queries[0]).toContain('LIMIT 100 FOR UPDATE SKIP LOCKED');
    expect(db.queries[0]).toContain('DELETE FROM melzi_research.drafts');
    expect(db.queries[1]).toContain('LIMIT 1000');
    expect(db.queries[2]).toContain('auto_closed = false LIMIT 100');
  });
  test('prior quota stops reopen only after preclear commit and while holding the session lock', async () => {
    const db = fakeDatabase({ priorClosed: true }); const task = housekeepingFor(db);
    expect((await task.handler(EVENT)).reopen).toBe('reopened');
    expect(task.calls).toHaveLength(1);
    expect(task.calls[0]).toBeInstanceOf(DeleteFunctionConcurrencyCommand);
    expect(db.events.indexOf('commit')).toBeLessThan(db.events.indexOf('aws-reopen'));
    expect(db.events.indexOf('aws-reopen')).toBeLessThan(db.events.indexOf('unlock'));
    expect(db.state).toMatchObject({ priorClosed: false, lock: 0 });
  });
  test('current-day quota exhaustion blocks reopening from any older marker', async () => {
    for (const today of [{ closed: true }, { requests: 10000 }]) {
      const db = fakeDatabase({ priorClosed: true, ...today }); const task = housekeepingFor(db);
      expect((await task.handler(EVENT)).reopen).toBe('current_day_closed');
      expect(task.calls).toHaveLength(0);
      expect(db.state.priorClosed).toBe(true);
    }
  });
  test('housekeeping does not race an active quota-close operation', async () => {
    const db = fakeDatabase({ priorClosed: true, busy: true }); const task = housekeepingFor(db);
    expect((await task.handler(EVENT)).reopen).toBe('busy');
    expect(task.calls).toHaveLength(0);
    expect(db.state.priorClosed).toBe(true);
  });
  test('failed reopen is best-effort stopped again and not retried next hour', async () => {
    const db = fakeDatabase({ priorClosed: true });
    const task = housekeepingFor(db, async command => { if (command instanceof DeleteFunctionConcurrencyCommand) throw new Error('private timeout'); });
    expect((await task.handler(EVENT)).reopen).toBe('manual_recovery_required');
    expect(task.calls).toHaveLength(2);
    expect(task.calls[1]).toBeInstanceOf(PutFunctionConcurrencyCommand);
    expect(db.state.priorClosed).toBe(false);
    expect((await task.handler(EVENT)).reopen).toBe('not_needed');
    expect(task.calls).toHaveLength(2);
    expect(task.logs.join(' ')).not.toContain('private');
  });
  test('both control-plane calls failing remains an explicit manual-recovery result', async () => {
    const db = fakeDatabase({ priorClosed: true }); const task = housekeepingFor(db, async () => { throw new Error('private AWS error'); });
    const result = await task.handler(EVENT);
    expect(result.ok).toBe(false);
    expect(result.reopen).toBe('manual_recovery_required');
    expect(task.logs).toContain('research_api_reopen_and_restop_failed_manual_recovery_required');
    expect(db.state.priorClosed).toBe(false);
  });
  test('failed marker commit never calls AWS reopen', async () => {
    const db = fakeDatabase({ priorClosed: true, failCommit: true }); const task = housekeepingFor(db);
    expect((await task.handler(EVENT)).reopen).toBe('manual_recovery_required');
    expect(task.calls).toHaveLength(0);
    expect(db.events).toContain('rollback');
  });
  test('uncertain session unlock destroys rather than recycles the connection', async () => {
    const db = fakeDatabase({ failUnlock: true }); const task = housekeepingFor(db);
    await task.handler(EVENT);
    expect(db.state.releasedDestroyed).toBe(true);
  });
  test('DB unavailability cannot cause automatic reopening and exposes no diagnostics', async () => {
    const logs: string[] = []; let calls = 0;
    const task = createHousekeeping({ getPool: async () => { throw new Error('private database/credentials'); }, log: line => logs.push(line), control: { async send() { calls++; return {}; } } });
    await expect(task.handler(EVENT)).rejects.toThrow('Research housekeeping unavailable');
    expect(calls).toBe(0);
    expect(logs).toEqual(['research_housekeeping_dependency_failed']);
  });
});

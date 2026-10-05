// TEMPORARY PRIVATE VERIFIER ONLY. Never attach a Function URL or public trigger.
// Bundle as index.js (CommonJS, package type=commonjs), handler index.handler.
// App credentials only; no master secret, unrestricted SQL, or token logging.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { database } from './database.js';
import { CIRCUIT_BREAKER_LOCK, createAdmission, UTC_DAY_SQL } from './admission.js';
import { cloudProvider } from './provider.js';
import { armTarget } from './azure-control.js';

interface Budget { day: string; requests: number; writes: number; creates: number; auto_closed: boolean; observed_invocations: number }
interface Snapshot { day: string; today: Budget | null; yesterday: Budget | null; proof: string }
type Event = { action?: string; runId?: string; tokenHash?: string; fixtureProof?: string; inspectOnly?: boolean; snapshot?: Snapshot; expected?: Snapshot };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const admission = createAdmission({ functionName: () => process.env.API_FUNCTION_NAME });
function requireRun(event: Event): string {
  const run = process.env.VERIFICATION_RUN_ID;
  const azure = cloudProvider() === 'azure';
  const target = azure ? armTarget(process.env).pathname.split('/').at(-1) : process.env.API_FUNCTION_NAME;
  const self = azure ? process.env.WEBSITE_SITE_NAME : process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!run || !UUID.test(run) || event.runId !== run || !target || target === self || (azure && process.env.PGUSER !== 'melzi_research_app')) throw new Error('Invalid private verification context');
  return run;
}
function signature(run: string, kind: string, value: unknown): string {
  return createHmac('sha256', run).update(`${kind}:${JSON.stringify(value)}`).digest('hex');
}
function equalProof(actual: unknown, expected: string): boolean {
  return typeof actual === 'string' && HASH.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function row(value: unknown): Budget | null {
  if (value === null) return null;
  const v = value as Budget;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.day) || ![v.requests, v.writes, v.creates, v.observed_invocations].every(n => Number.isSafeInteger(n) && n >= 0) || typeof v.auto_closed !== 'boolean') throw new Error('Invalid budget snapshot');
  return { day: v.day, requests: v.requests, writes: v.writes, creates: v.creates, auto_closed: v.auto_closed, observed_invocations: v.observed_invocations };
}
function verifySnapshot(value: Snapshot | undefined, run: string): Snapshot {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) throw new Error('Snapshot is required');
  const normalized = { day: value.day, today: row(value.today), yesterday: row(value.yesterday) };
  if (!equalProof(value.proof, signature(run, 'budget', normalized))) throw new Error('Invalid snapshot proof');
  return { ...normalized, proof: value.proof };
}
async function snapshot(connection: PoolClient, run: string, lock = false): Promise<Snapshot> {
  const clock = await connection.query<{ day: string; previous: string }>(`SELECT ${UTC_DAY_SQL}::text AS day, (${UTC_DAY_SQL} - 1)::text AS previous`);
  const { day, previous } = clock.rows[0];
  const result = await connection.query<Budget>(`SELECT day::text AS day, requests, writes, creates, auto_closed, observed_invocations FROM melzi_research.daily_budget
    WHERE day IN ($1::date, $2::date) ORDER BY day ${lock ? 'FOR UPDATE' : ''}`, [day, previous]);
  const data = { day, today: row(result.rows.find(item => item.day === day) ?? null), yesterday: row(result.rows.find(item => item.day === previous) ?? null) };
  return { ...data, proof: signature(run, 'budget', data) };
}
function requireSame(actual: Snapshot, expected: Snapshot): void {
  if (actual.day !== expected.day || actual.proof !== expected.proof) throw new Error('Quota state changed during verification');
}
async function transaction<T>(pool: Pool, work: (connection: PoolClient) => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  let destroy = false;
  try {
    await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => { destroy = true; });
    throw error;
  } finally { connection.release(destroy ? new Error('Verifier connection reset required') : undefined); }
}
async function replaceBudget(connection: PoolClient, day: string, budget: Budget | null): Promise<void> {
  if (!budget) {
    await connection.query('DELETE FROM melzi_research.daily_budget WHERE day=$1::date', [day]);
    return;
  }
  if (budget.day !== day) throw new Error('Wrong budget date');
  await connection.query(`INSERT INTO melzi_research.daily_budget(day,requests,writes,creates,auto_closed,observed_invocations)
    VALUES($1::date,$2,$3,$4,$5,$6) ON CONFLICT(day) DO UPDATE SET
    requests=excluded.requests,writes=excluded.writes,creates=excluded.creates,auto_closed=excluded.auto_closed,observed_invocations=excluded.observed_invocations`,
  [day, budget.requests, budget.writes, budget.creates, budget.auto_closed, budget.observed_invocations]);
}
async function previousDay(connection: PoolClient): Promise<string> {
  return (await connection.query<{ day: string }>(`SELECT (${UTC_DAY_SQL} - 1)::text AS day`)).rows[0].day;
}
async function quotaSnapshot(pool: Pool, run: string) {
  return transaction(pool, connection => snapshot(connection, run));
}
function requireTokenHash(event: Event): string {
  if (typeof event.tokenHash !== 'string' || !HASH.test(event.tokenHash)) throw new Error('Invalid fixture identifier');
  return event.tokenHash;
}

export async function handler(event: Event) {
  try {
    const run = requireRun(event);
    const marker = `[melzi verification ${run}]`;
    const pool = await database();
    if (event.action === 'probe') {
      const connection = await pool.connect();
      try {
        const tls = await connection.query('SELECT ssl,version,cipher FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
        const role = await connection.query(`SELECT current_user AS username,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
          has_schema_privilege(current_user,'melzi_research','CREATE') AS schema_create,
          has_table_privilege(current_user,'melzi_research.drafts','SELECT,INSERT,UPDATE,DELETE') AS draft_access,
          has_table_privilege(current_user,'melzi_research.drafts','TRUNCATE') AS can_truncate
          FROM pg_roles WHERE rolname=current_user`);
        return { ok: true, tls: tls.rows[0], role: role.rows[0] };
      } finally { connection.release(); }
    }
    if (event.action === 'quotaSnapshot') return { ok: true, snapshot: await quotaSnapshot(pool, run) };
    if (event.action === 'quotaStop' || event.action === 'armQuota') {
      if (event.action === 'quotaStop' && cloudProvider() === 'azure') throw new Error('Azure verification must exercise the actual API self-stop');
      const original = verifySnapshot(event.snapshot, run);
      if (original.today?.auto_closed || original.yesterday?.auto_closed || (original.today?.requests ?? 0) >= 9900) throw new Error('Unsafe initial quota state');
      await transaction(pool, async connection => {
        await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [CIRCUIT_BREAKER_LOCK]);
        requireSame(await snapshot(connection, run, true), original);
        await replaceBudget(connection, original.day, { day: original.day, requests: 9999, writes: original.today?.writes ?? 0, creates: original.today?.creates ?? 0, auto_closed: false, observed_invocations: original.today?.observed_invocations ?? 0 });
      });
      if (event.action === 'quotaStop') await admission.reserveInvocation(pool); // AWS-only legacy proof.
      // armQuota performs no control call: the next REAL API invocation must
      // persist its own closure before stopping that executing Azure worker.
      return { ok: true, snapshot: await quotaSnapshot(pool, run) };
    }
    if (event.action === 'prepareRollover') {
      const original = verifySnapshot(event.snapshot, run);
      const expected = verifySnapshot(event.expected, run);
      if (original.day !== expected.day || expected.today?.requests !== 10000 || expected.today.auto_closed !== true) throw new Error('Quota stop was not confirmed');
      return transaction(pool, async connection => {
        await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [CIRCUIT_BREAKER_LOCK]);
        requireSame(await snapshot(connection, run, true), expected);
        const yesterday = await previousDay(connection);
        await replaceBudget(connection, original.day, { day: original.day, requests: original.today?.requests ?? 0, writes: original.today?.writes ?? 0, creates: original.today?.creates ?? 0, auto_closed: false, observed_invocations: expected.today!.observed_invocations });
        await replaceBudget(connection, yesterday, { day: yesterday, requests: 10000, writes: original.yesterday?.writes ?? 0, creates: original.yesterday?.creates ?? 0, auto_closed: true, observed_invocations: original.yesterday?.observed_invocations ?? 0 });
        return { ok: true, snapshot: await snapshot(connection, run) };
      });
    }
    if (event.action === 'restoreSnapshot') {
      const original = verifySnapshot(event.snapshot, run);
      const expected = verifySnapshot(event.expected, run);
      if (original.day !== expected.day) throw new Error('Refusing a UTC-crossing restore');
      return transaction(pool, async connection => {
        await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [CIRCUIT_BREAKER_LOCK]);
        requireSame(await snapshot(connection, run, true), expected);
        await replaceBudget(connection, original.day, original.today);
        await replaceBudget(connection, await previousDay(connection), original.yesterday);
        return { ok: true, snapshot: await snapshot(connection, run) };
      });
    }
    if (event.action === 'cleanupAbandonedRun') {
      return transaction(pool, async connection => {
        // No bearer survives a hard-killed runner. Recover only this private
        // verifier's environment-bound marker, never an event-provided prefix.
        // Read one extra match to fail closed if the expected two-row ceiling
        // is exceeded; no mutation occurs in that case.
        const fixtures = await connection.query<{ token_hash: string }>(`SELECT token_hash FROM melzi_research.drafts
          WHERE left(answers->>'contextDetails',length($1))=$1 LIMIT 3 FOR UPDATE`, [marker]);
        if (fixtures.rows.length > 2) throw new Error('Unexpected abandoned fixture count');
        let deleted = 0;
        for (const fixture of fixtures.rows) {
          if (!HASH.test(fixture.token_hash)) throw new Error('Invalid fixture identifier');
          await connection.query('INSERT INTO melzi_research.retired_sessions(token_hash) VALUES($1) ON CONFLICT DO NOTHING', [fixture.token_hash]);
          deleted += (await connection.query(`DELETE FROM melzi_research.drafts WHERE token_hash=$1
            AND left(answers->>'contextDetails',length($2))=$2`, [fixture.token_hash, marker])).rowCount ?? 0;
        }
        // Receipt deletion is the existing FK cascade; tombstones intentionally
        // remain. Return counts only, never hashes, answers, or marker material.
        return { ok: true, deletedDrafts: deleted, retiredTombstonesRetained: true, quotaStateNotModified: true };
      });
    }
    if (event.action === 'expireFixture') {
      const tokenHash = requireTokenHash(event);
      const expired = await pool.query(`UPDATE melzi_research.drafts SET expires_at=now()-interval '1 hour'
        WHERE token_hash=$1 AND left(answers->>'contextDetails',length($2))=$2 RETURNING token_hash`, [tokenHash, marker]);
      if (expired.rowCount !== 1) throw new Error('Matching fixture was not found');
      return { ok: true, expired: 1, fixtureProof: signature(run, 'fixture', { tokenHash, marker }) };
    }
    if (event.action === 'cleanupFixture') {
      const tokenHash = requireTokenHash(event);
      return transaction(pool, async connection => {
        const found = await connection.query<{ matched: boolean }>(`SELECT left(answers->>'contextDetails',length($2))=$2 AS matched
          FROM melzi_research.drafts WHERE token_hash=$1 FOR UPDATE`, [tokenHash, marker]);
        if (found.rowCount && found.rows[0].matched !== true) throw new Error('Refusing unmatched fixture');
        if (!found.rowCount && !equalProof(event.fixtureProof, signature(run, 'fixture', { tokenHash, marker }))) {
          if (event.inspectOnly === true) throw new Error('Missing retired fixture proof');
          // Ambiguous create failures still run cleanup. With no matching live
          // row and no proof, a no-op is safe; do not inspect/delete a tombstone.
          return { ok: true, deletedDrafts: 0, noFixtureFound: true, retiredTombstoneRetained: true };
        }
        const retired = await connection.query('SELECT 1 FROM melzi_research.retired_sessions WHERE token_hash=$1', [tokenHash]);
        if (event.inspectOnly === true) return { ok: true, draftExists: !!found.rowCount, retiredExists: !!retired.rowCount };
        let deleted = 0;
        if (found.rowCount) {
          // Keep tombstones intentionally: app role has no DELETE permission on
          // retired_sessions, and retired credentials must never become valid.
          await connection.query('INSERT INTO melzi_research.retired_sessions(token_hash) VALUES($1) ON CONFLICT DO NOTHING', [tokenHash]);
          deleted = (await connection.query(`DELETE FROM melzi_research.drafts WHERE token_hash=$1
            AND left(answers->>'contextDetails',length($2))=$2`, [tokenHash, marker])).rowCount ?? 0;
        }
        return { ok: true, deletedDrafts: deleted, retiredTombstoneRetained: true, fixtureProof: signature(run, 'fixture', { tokenHash, marker }) };
      });
    }
    throw new Error('Unsupported verification action');
  } catch {
    // No error objects, request bodies, hashes, proof material, or secrets logged.
    return { ok: false, error: 'verification_failed' };
  }
}

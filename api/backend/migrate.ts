import { readSecret, poolFromSecret } from './database.js';

export async function handler(event:{action?:string}){
  if(event.action!=='migrate')throw new Error('Unsupported migration action');
  const [master,app]=await Promise.all([readSecret(process.env.MASTER_SECRET_ARN!),readSecret(process.env.DB_SECRET_ARN!)]);
  return migrateDatabase(master,app);
}

export async function migrateDatabase(master:Record<string,string>,app:Record<string,string>){
  if(app.username!=='melzi_research_app'||app.host!==master.host||app.dbname!==master.dbname||!app.password||app.password.includes('\0'))throw new Error('Unexpected app database configuration');
  const pool=poolFromSecret(master);const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SET LOCAL standard_conforming_strings = on');
    await client.query('SELECT pg_advisory_xact_lock(472899465385)');
    await client.query('CREATE SCHEMA IF NOT EXISTS melzi_research');
    await client.query('REVOKE ALL ON SCHEMA melzi_research FROM PUBLIC');
    const role=await client.query('SELECT oid,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[app.username]);
    if(role.rowCount){
      if(['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].some(key=>role.rows[0][key]))throw new Error('Existing app role has unexpected privileges');
      const memberships=await client.query('SELECT 1 FROM pg_auth_members WHERE member=$1',[role.rows[0].oid]);
      if(memberships.rowCount)throw new Error('Existing app role has unexpected memberships');
    }
    // PostgreSQL utility statements cannot bind password parameters. Quote this
    // server-generated secret as a SQL literal; never log SQL or error text.
    const password="'"+app.password.replaceAll("'","''")+"'";
    if(!role.rowCount)await client.query(`CREATE ROLE melzi_research_app LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    else await client.query(`ALTER ROLE melzi_research_app PASSWORD ${password}`);
    await client.query('ALTER ROLE melzi_research_app SET search_path = pg_catalog, melzi_research');
    await client.query('ALTER ROLE melzi_research_app CONNECTION LIMIT 10');
    await client.query(`CREATE TABLE IF NOT EXISTS melzi_research.drafts (
      token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
      draft_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      answers jsonb NOT NULL, summary jsonb NOT NULL, step text NOT NULL,
      completed boolean NOT NULL DEFAULT false,
      revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days', submitted_at timestamptz,
      window_started_at timestamptz NOT NULL DEFAULT now(), window_writes integer NOT NULL DEFAULT 1
    )`);
    await client.query('CREATE INDEX IF NOT EXISTS drafts_expiry ON melzi_research.drafts(expires_at)');
    await client.query('CREATE INDEX IF NOT EXISTS drafts_status_updated ON melzi_research.drafts(completed,updated_at)');
    await client.query(`CREATE TABLE IF NOT EXISTS melzi_research.receipts (
      token_hash text NOT NULL REFERENCES melzi_research.drafts(token_hash) ON DELETE CASCADE,
      mutation_id uuid NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(token_hash,mutation_id)
    )`);
    await client.query('CREATE INDEX IF NOT EXISTS receipts_expiry ON melzi_research.receipts(created_at)');
    await client.query(`CREATE TABLE IF NOT EXISTS melzi_research.daily_budget (day date PRIMARY KEY,writes integer NOT NULL,creates integer NOT NULL)`);
    await client.query('ALTER TABLE melzi_research.daily_budget ADD COLUMN IF NOT EXISTS requests integer NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE melzi_research.daily_budget ADD COLUMN IF NOT EXISTS auto_closed boolean NOT NULL DEFAULT false');
    await client.query('ALTER TABLE melzi_research.daily_budget ADD COLUMN IF NOT EXISTS observed_invocations integer NOT NULL DEFAULT 0');
    await client.query(`CREATE TABLE IF NOT EXISTS melzi_research.retired_sessions (token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),retired_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA melzi_research FROM PUBLIC');
    await client.query('GRANT CONNECT ON DATABASE '+ '"'+master.dbname.replaceAll('"','""')+'"'+' TO melzi_research_app');
    await client.query('GRANT USAGE ON SCHEMA melzi_research TO melzi_research_app');
    await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON melzi_research.drafts,melzi_research.receipts,melzi_research.daily_budget TO melzi_research_app');
    await client.query('GRANT SELECT,INSERT ON melzi_research.retired_sessions TO melzi_research_app');
    await client.query('COMMIT');return {ok:true,schema:'melzi_research'};
  }catch{await client.query('ROLLBACK').catch(()=>{});throw new Error('Research database migration failed; no changes committed.');}
  finally{client.release();await pool.end();}
}

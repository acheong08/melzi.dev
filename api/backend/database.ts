import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { cloudProvider, type CloudProvider } from './provider.js';

const secrets=new SecretsManagerClient({region:process.env.AWS_REGION||'us-east-1',maxAttempts:2,requestHandler:{connectionTimeout:1000,requestTimeout:1800}});
let pool:Pool|undefined;
let loadedAt=0;
let loading:Promise<Pool>|undefined;
export async function readSecret(arn:string):Promise<Record<string,string>>{
  const response=await secrets.send(new GetSecretValueCommand({SecretId:arn}));
  if(!response.SecretString)throw new Error('Missing database secret');
  return JSON.parse(response.SecretString);
}
export function azureDatabaseSecret(env:NodeJS.ProcessEnv=process.env):Record<string,string> {
  const host=env.PGHOST,username=env.PGUSER,password=env.PGPASSWORD,dbname=env.PGDATABASE;
  if(!host||! /^[a-z0-9][a-z0-9.-]*\.postgres\.database\.azure\.com$/i.test(host)||
     !username||! /^[a-z_][a-z0-9_]{0,62}$/i.test(username)||!password||password.includes('\0')||password.length>4096||
     dbname!=='melzi_research'||(env.PGPORT!==undefined&&env.PGPORT!=='5432'))throw new Error('Invalid Azure database configuration');
  return {host,username,password,dbname,port:'5432'};
}
export function poolFromSecret(secret:Record<string,string>,provider:CloudProvider=cloudProvider()):Pool {
  const created=new Pool({host:secret.host,port:Number(secret.port||5432),database:secret.dbname,user:secret.username,password:secret.password,max:1,connectionTimeoutMillis:2000,idleTimeoutMillis:30000,allowExitOnIdle:true,
    ssl:provider==='azure'?{rejectUnauthorized:true,servername:secret.host}:{ca:readFileSync(join(process.env.LAMBDA_TASK_ROOT||process.cwd(),'rds-ca.pem'),'utf8'),rejectUnauthorized:true},
    options:'-c statement_timeout=1800 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=3000',application_name:'melzi-research'});
  created.on('error',()=>{console.error('postgres_idle_connection_error');});
  return created;
}
export async function database():Promise<Pool>{
  if(pool&&Date.now()-loadedAt<900000)return pool;
  if(loading)return loading;
  loading=(async()=>{
    const secret=cloudProvider()==='azure'?azureDatabaseSecret():await readSecret(process.env.DB_SECRET_ARN!);
    const next=poolFromSecret(secret);const old=pool;pool=next;loadedAt=Date.now();if(old)await old.end();return next;
  })();
  try{return await loading;}finally{loading=undefined;}
}

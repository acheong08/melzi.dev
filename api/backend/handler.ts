import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { database } from './database.js';
import { reserveInvocation, stopOnDependencyFailure } from './admission.js';
import { ApiFailure, parseMutation, projectedResponse } from './validation.js';
import { MAX_REQUEST_BYTES } from '../../src/lib/research/persistence-contract.js';

export type UrlEvent={body?:string;readBody?:()=>Promise<Uint8Array>;isBase64Encoded?:boolean;headers?:Record<string,string>;rawPath?:string;source?:string;'detail-type'?:string;requestContext?:{http?:{method?:string};authorizer?:{iam?:{userArn?:string}}}};
export interface HandlerDependencies {
  getPool?:()=>Promise<Pool>;
  reserve?: (pool:Pool)=>Promise<void>;
  stop?:()=>Promise<boolean>;
  credential?:(headers:Record<string,string>)=>unknown;
  validateHeaders?:(headers:Record<string,string>)=>void;
  preflight?:(headers:Record<string,string>)=>void;
  countEveryInvocation?:boolean;
}
const json=(statusCode:number,body:unknown,retryAfter?:number)=>({statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...(retryAfter?{'retry-after':String(retryAfter)}:{})},body:JSON.stringify(body)});
export function credentialHash(token:unknown):string {
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new ApiFailure(401,'invalid_session','A valid session credential is needed.');
  const bytes=Buffer.from(token,'base64url');
  if(bytes.length!==32||bytes.toString('base64url')!==token)throw new ApiFailure(401,'invalid_session','A valid session credential is needed.');
  return createHash('sha256').update(bytes).digest('hex');
}
export function createHandler(dependencies:HandlerDependencies={}) {
 const getPool=dependencies.getPool??database;
 const reserve=dependencies.reserve??reserveInvocation;
 const stop=dependencies.stop??stopOnDependencyFailure;
 return async function handler(event:UrlEvent){
  try{
    const method=event.requestContext?.http?.method;
    const routed=event.rawPath==='/v1/draft'&&(['POST','PUT','GET'].includes(method||'')||(method==='OPTIONS'&&!!dependencies.preflight));
    if(!routed&&!dependencies.countEveryInvocation)return json(404,{error:'not_found',message:'Not found.'});
    const pool=await getPool();
    await reserve(pool);
    if(!routed)return json(404,{error:'not_found',message:'Not found.'});
    const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([key,value])=>[key.toLowerCase(),value]));
    dependencies.validateHeaders?.(headers);
    if(method==='OPTIONS'&&dependencies.preflight){dependencies.preflight(headers);return {...json(204,null),body:''};}
    // AWS's trusted gateway owns its internal header; Azure supplies a strict
    // public Bearer parser and never trusts incoming x-melzi-* headers.
    const tokenHash=credentialHash(dependencies.credential?dependencies.credential(headers):headers['x-melzi-session']);
    if(method==='GET'){
      const found=await pool.query('SELECT answers,step,completed,revision,updated_at,expires_at FROM melzi_research.drafts WHERE token_hash=$1',[tokenHash]);
      if(!found.rowCount){
        const retired=await pool.query('SELECT 1 FROM melzi_research.retired_sessions WHERE token_hash=$1',[tokenHash]);
        if(retired.rowCount)throw new ApiFailure(410,'session_expired','This draft has expired.');
        throw new ApiFailure(404,'session_not_found','This draft was not found.');
      }
      const row=found.rows[0];if(new Date(row.expires_at).getTime()<=Date.now())throw new ApiFailure(410,'session_expired','This draft has expired.');
      return json(200,{schemaVersion:4,answers:row.answers,step:row.step,completed:row.completed,revision:row.revision,savedAt:row.updated_at.toISOString(),expiresAt:row.expires_at.toISOString()});
    }
    if(!/^application\/json(?:\s*;|$)/i.test(headers['content-type']||''))throw new ApiFailure(400,'invalid_content_type','Send JSON content.');
    const bytes=event.readBody?Buffer.from(await event.readBody()):event.isBase64Encoded?Buffer.from(event.body||'','base64'):Buffer.from(event.body||'','utf8');
    if(bytes.length>MAX_REQUEST_BYTES)throw new ApiFailure(413,'too_large','The response is too large.');
    let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ApiFailure(400,'invalid_json','Invalid text encoding.');}
    const mutation=parseMutation(raw);
    const digest=createHash('sha256').update(bytes).digest('hex');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // A token-scoped transaction lock also serializes concurrent first creates.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tokenHash]);
      const found=await client.query('SELECT revision,expires_at,window_started_at,window_writes FROM melzi_research.drafts WHERE token_hash=$1 FOR UPDATE',[tokenHash]);
      const existing=found.rows[0];
      if(!existing){
        const retired=await client.query('SELECT 1 FROM melzi_research.retired_sessions WHERE token_hash=$1',[tokenHash]);
        if(retired.rowCount)throw new ApiFailure(410,'session_expired','This draft has expired.');
      }
      if(existing&&new Date(existing.expires_at).getTime()<=Date.now())throw new ApiFailure(410,'session_expired','This draft has expired.');
      if(existing){
        const receipt=await client.query('SELECT payload_hash,result FROM melzi_research.receipts WHERE token_hash=$1 AND mutation_id=$2',[tokenHash,mutation.mutationId]);
        if(receipt.rowCount){
          if(receipt.rows[0].payload_hash!==digest)throw new ApiFailure(409,'mutation_reused','A save identifier was reused with different answers.',existing.revision);
          await client.query('COMMIT');return json(200,receipt.rows[0].result);
        }
      }
      if(method==='POST'&&(mutation.expectedRevision!==0||mutation.completed))throw new ApiFailure(400,'invalid_creation','Start with an unfinished draft at revision zero.');
      if(method==='POST'&&existing)throw new ApiFailure(409,'conflict','This draft already exists. Reload its saved version.',existing.revision);
      if(method==='PUT'&&!existing)throw new ApiFailure(404,'session_not_found','This draft was not found.');
      if(existing&&existing.revision!==mutation.expectedRevision)throw new ApiFailure(409,'conflict','This draft changed elsewhere. Reload its saved version.',existing.revision);
      if(existing&&new Date(existing.window_started_at).getTime()>Date.now()-3600000&&existing.window_writes>=120)throw new ApiFailure(429,'session_limit','This draft has reached its hourly save limit.',undefined,Math.max(1,Math.ceil((new Date(existing.window_started_at).getTime()+3600000-Date.now())/1000)));
      const budget=await client.query(`INSERT INTO melzi_research.daily_budget(day,writes,creates) VALUES ((now() AT TIME ZONE 'UTC')::date,1,$1)
        ON CONFLICT(day) DO UPDATE SET writes=melzi_research.daily_budget.writes+1,creates=melzi_research.daily_budget.creates+$1
        WHERE melzi_research.daily_budget.writes<10000 AND melzi_research.daily_budget.creates+$1<=500 RETURNING day`,[existing?0:1]);
      if(!budget.rowCount)throw new ApiFailure(429,'daily_limit','Saving has reached its daily allowance. Please try later.',undefined,Math.max(1,Math.ceil((Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),new Date().getUTCDate()+1)-Date.now())/1000)));
      const summary=projectedResponse(mutation.answers);
      const saved=existing
        ? await client.query(`UPDATE melzi_research.drafts SET answers=$2,step=$3,completed=$4,summary=$5,revision=revision+1,updated_at=now(),expires_at=now()+CASE WHEN $4 THEN interval '365 days' ELSE interval '30 days' END,
            submitted_at=CASE WHEN $4 THEN now() ELSE NULL END,
            window_writes=CASE WHEN window_started_at<now()-interval '1 hour' THEN 1 ELSE window_writes+1 END,
            window_started_at=CASE WHEN window_started_at<now()-interval '1 hour' THEN now() ELSE window_started_at END
            WHERE token_hash=$1 AND revision=$6 RETURNING revision,updated_at,expires_at,completed`,[tokenHash,JSON.stringify(mutation.answers),mutation.step,mutation.completed,JSON.stringify(summary),mutation.expectedRevision])
        : await client.query(`INSERT INTO melzi_research.drafts(token_hash,answers,step,completed,summary) VALUES($1,$2,$3,false,$4) RETURNING revision,updated_at,expires_at,completed`,[tokenHash,JSON.stringify(mutation.answers),mutation.step,JSON.stringify(summary)]);
      if(!saved.rowCount)throw new ApiFailure(409,'conflict','This draft changed elsewhere.');
      const row=saved.rows[0];const result={revision:row.revision,savedAt:row.updated_at.toISOString(),expiresAt:row.expires_at.toISOString(),completed:row.completed};
      await client.query('INSERT INTO melzi_research.receipts(token_hash,mutation_id,payload_hash,result) VALUES($1,$2,$3,$4)',[tokenHash,mutation.mutationId,digest,JSON.stringify(result)]);
      await client.query('COMMIT');return json(existing?200:201,result);
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }catch(error){
    if(error instanceof ApiFailure)return json(error.status,{error:error.code,message:error.message,...(error.revision!==undefined?{revision:error.revision}:{})},error.retryAfter);
    await stop();
    const code=(error as {code?:unknown})?.code;
    console.error('research_api_unavailable',typeof code==='string'&&/^[A-Z0-9]{5}$/.test(code)?code:'dependency_error');
    return json(503,{error:'unavailable',message:'Saving is temporarily unavailable. Please try again.'},15);
  }
 };
}
export const handler=createHandler();

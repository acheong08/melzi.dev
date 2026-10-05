import { build } from 'esbuild';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root=resolve(import.meta.dirname);
const out=join(root,'dist-backend');
await mkdir(out,{recursive:true});
const caResponse=await fetch('https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem');
if(!caResponse.ok)throw new Error('Unable to download the official AWS RDS trust bundle');
const ca=await caResponse.text();
if(!ca.includes('-----BEGIN CERTIFICATE-----'))throw new Error('Invalid RDS trust bundle');
const manifest={};
for(const [name,entry] of [['api','backend/handler.ts'],['migration','backend/migrate.ts'],['housekeeping','backend/housekeeping.ts'],['verification','backend/verify.ts']]){
  const dir=join(out,name);await mkdir(dir,{recursive:true});
  await build({absWorkingDir:root,entryPoints:[entry],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:join(dir,'index.js'),external:['pg-native'],tsconfigRaw:{compilerOptions:{}},logLevel:'warning'});
  await writeFile(join(dir,'rds-ca.pem'),ca);
  await writeFile(join(dir,'package.json'),'{"type":"commonjs"}\n');
  const zip=join(out,`${name}.zip`);await rm(zip,{force:true});
  execFileSync('zip',['-q','-j',zip,join(dir,'index.js'),join(dir,'rds-ca.pem'),join(dir,'package.json')]);
  const sha=createHash('sha256').update(await readFile(zip)).digest('hex');
  manifest[name]={file:zip,key:`releases/${name}-${sha}.zip`};
}
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Built API, migration, housekeeping, and verification artifacts with the official RDS CA bundle.');

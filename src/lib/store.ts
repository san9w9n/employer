import {Pool} from 'pg';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sampleStore} from './sample';
import type {Store} from './types';
const keys=['accounts','employees','attendance','wageHistory','periodHistory','audits','sessions','requests'] as const;
const tables={accounts:'accounts',employees:'employees',attendance:'attendance',wageHistory:'wage_history',periodHistory:'period_history',audits:'audits',sessions:'sessions',requests:'request_records'};
const globalStore=globalThis as typeof globalThis & {appPool?:Pool;demoQueue?:Promise<unknown>};
export const isDemo=()=>process.env.DEMO_MODE==='true';
function pool(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL 또는 DEMO_MODE=true 설정이 필요합니다.');return globalStore.appPool??=new Pool({connectionString:process.env.DATABASE_URL,max:1,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,allowExitOnIdle:true,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true,ca:process.env.DATABASE_SSL_CA?.replace(/\\n/g,'\n')}:undefined});}
export async function transaction<T>(fn:(store:Store)=>T|Promise<T>,options:{initializeDemo?:boolean}={}):Promise<T>{
 if(isDemo()){
  if(process.env.VERCEL)throw new Error('DEMO_MODE is local-only. Configure PostgreSQL for Vercel.');
  const run=async()=>{const file=process.env.DEMO_DATA_PATH??path.join(process.cwd(),'.data/demo.json');await mkdir(path.dirname(file),{recursive:true});let store:Store;try{store=JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;store=options.initializeDemo===false?{accounts:[],employees:[],attendance:[],wageHistory:[],periodHistory:[],audits:[],sessions:[],requests:[]}:sampleStore();}const result=await fn(store);const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(store),{mode:0o600});await rename(temp,file);return result;};
  const pending=(globalStore.demoQueue??Promise.resolve()).then(run,run);globalStore.demoQueue=pending.catch(()=>{});return pending;
 }
 const client=await pool().connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(83491271)");const store={} as Store;
 for(const key of keys){const result=await client.query(`SELECT payload FROM ${tables[key]}`);(store[key] as unknown[])=result.rows.map(r=>r.payload);}
 const original=structuredClone(store);const result=await fn(store);
 // One connection and lock protects cross-entity invariants and idempotency.
 for(const key of keys){const previous=new Map(original[key].map(v=>[v.id,JSON.stringify(v)]));for(const row of store[key]){const payload=JSON.stringify(row);if(previous.get(row.id)!==payload)await client.query(`INSERT INTO ${tables[key]} (id,payload) VALUES ($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`,[row.id,payload]);previous.delete(row.id);}for(const id of previous.keys())await client.query(`DELETE FROM ${tables[key]} WHERE id=$1`,[id]);}
 await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

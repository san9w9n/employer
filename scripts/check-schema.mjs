import {readdir} from 'node:fs/promises';
import {Pool} from 'pg';

// Deployment must not publish application code against an older database.
// This check is read-only; apply migrations separately with the migration role.
async function main(){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required to verify the deployment schema.');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true,ca:process.env.DATABASE_SSL_CA?.replace(/\\n/g,'\n')}:undefined});
 let client;
 try{
  client=await pool.connect();
  await client.query('BEGIN READ ONLY');
  const files=(await readdir(new URL('../migrations/',import.meta.url))).filter(name=>/^\d+.*\.cjs$/.test(name)).map(name=>name.slice(0,-4));
  const applied=await client.query('SELECT name FROM pgmigrations');
  const pending=files.filter(name=>!applied.rows.some(row=>row.name===name));
  if(pending.length)throw Error(`Database migrations are pending: ${pending.join(', ')}. Apply npm run db:up before deployment.`);
  const constraints=await client.query("SELECT conname FROM pg_constraint WHERE conrelid='public.attendance'::regclass AND conname='attendance_unique_day'");
  if(constraints.rowCount)throw Error('The obsolete attendance_unique_day constraint still blocks re-entry. Repair the migration state before deployment.');
  const openIndex=await client.query("SELECT pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0] WHERE i.indexrelid=to_regclass('public.one_open_attendance') AND i.indrelid='public.attendance'::regclass AND i.indisunique AND i.indisvalid AND i.indnkeyatts=1 AND a.attname='employee_id'");
  const predicate=openIndex.rows[0]?.predicate?.replace(/[\s()]/g,'');
  if(predicate!=="payload->>'clockOut'::textISNULL")throw Error('The one_open_attendance unique index is missing or invalid. Restore the open-shift constraint before deployment.');
  console.log(`PASS deployment schema: ${files.length} migrations applied; repeated shifts allowed; one-open-shift protection present`);
 }finally{try{if(client)await client.query('ROLLBACK')}finally{client?.release();await pool.end()}}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Schema verification failed');process.exitCode=1});

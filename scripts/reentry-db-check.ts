import assert from 'node:assert/strict';
import {runner} from 'node-pg-migrate';
import {Pool} from 'pg';
import {spawnSync} from 'node:child_process';
import {sampleStore} from '../src/lib/sample';
import {mutate,AppError} from '../src/lib/service';
import {transaction} from '../src/lib/store';
import {seoulDate} from '../src/lib/domain';

async function main(){
 const databaseUrl=process.env.DATABASE_URL;
 assert(databaseUrl&&process.env.ALLOW_LOCAL_VERIFY==='true','Explicit disposable local test database required');
 assert(['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname),'Only loopback PostgreSQL is allowed');
 assert.notEqual(process.env.DEMO_MODE,'true','Use real PostgreSQL');
 const pool=new Pool({connectionString:databaseUrl});
 try{
  const initial=await pool.query("SELECT to_regclass('public.accounts') AS name");
  assert.equal(initial.rows[0].name,null,'Use a fresh database; existing application data must not be touched');
  const options={databaseUrl,migrationsTable:'pgmigrations',dir:'migrations',direction:'up' as const};
  await runner({...options,count:2});
  const blockedBuild=spawnSync(process.execPath,['scripts/check-schema.mjs'],{encoding:'utf8'});assert.equal(blockedBuild.status,1);assert.match(blockedBuild.stderr,/migrations are pending/);
  console.log('PASS deployment blocked before missing migration is applied');
  const seed=sampleStore();seed.attendance=[];seed.audits=[];seed.requests=[];
  await transaction(s=>Object.assign(s,seed));
  const employee=seed.accounts.find(a=>a.employeeId==='emp-1')!;
  const clock=(action:'in'|'out',requestId:string)=>transaction(s=>mutate(s,employee,'clock',{action,requestId}));
  const snapshot=()=>transaction(s=>structuredClone({attendance:s.attendance,audits:s.audits,requests:s.requests}));
  await clock('in','first-in');await clock('out','first-out');
  const before=await snapshot();
  await assert.rejects(clock('in','old-schema-in'),(e:unknown)=>Boolean(e&&typeof e==='object'&&'code'in e&&e.code==='23505'&&'constraint'in e&&e.constraint==='attendance_unique_day'));
  assert.deepEqual(await snapshot(),before,'Failed re-entry must roll back records, audit and request key');
  console.log('PASS reproduced production unique-day rejection (23505), with complete rollback');
  await runner({...options,count:Infinity});
  const readyBuild=spawnSync(process.execPath,['scripts/check-schema.mjs'],{encoding:'utf8'});assert.equal(readyBuild.status,0,readyBuild.stderr);
  console.log('PASS deployment schema check after migration');
  // A similarly named index without the partial predicate is not sufficient.
  await pool.query('DROP INDEX one_open_attendance');
  const missingIndex=spawnSync(process.execPath,['scripts/check-schema.mjs'],{encoding:'utf8'});assert.equal(missingIndex.status,1);assert.match(missingIndex.stderr,/one_open_attendance/);
  await pool.query('CREATE UNIQUE INDEX one_open_attendance ON attendance(employee_id)');
  const incorrectIndex=spawnSync(process.execPath,['scripts/check-schema.mjs'],{encoding:'utf8'});assert.equal(incorrectIndex.status,1);assert.match(incorrectIndex.stderr,/one_open_attendance/);
  await pool.query("DROP INDEX one_open_attendance; CREATE UNIQUE INDEX one_open_attendance ON attendance(employee_id) WHERE payload->>'clockOut' IS NULL");
  console.log('PASS deployment rejects missing or incorrectly defined open-shift index');
  assert.deepEqual(await snapshot(),before,'Migration must preserve all existing records and metadata');
  const results=await Promise.all([clock('in','second-in'),clock('in','second-in')]);
  assert.deepEqual(results[0],results[1]);
  assert.equal((await snapshot()).attendance.length,2);
  await assert.rejects(clock('in','duplicate-open'),e=>e instanceof AppError&&e.status===409);
  const secondOut=await clock('out','second-out');
  const attempts=await Promise.allSettled([clock('in','third-in-a'),clock('in','third-in-b')]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
  assert.deepEqual(await clock('out','second-out'),secondOut,'Old retry returns its original result');
  assert.equal((await snapshot()).attendance.filter(a=>!a.clockOut).length,1,'Old checkout retry cannot close a new shift');
  await clock('out','third-out');
  const repeated=await snapshot();assert.equal(repeated.attendance.length,3);assert.equal(new Set(repeated.attendance.map(a=>a.workDate)).size,1);
  assert(repeated.attendance.every(a=>a.clockOut));assert.equal(repeated.audits.length,6);
  console.log('PASS three same-day shifts, concurrent idempotency, duplicate-open rejection and old retry isolation');
  // Verify the database still enforces only one open shift even without the service layer.
  await clock('in','fourth-in');const open=(await snapshot()).attendance.find(a=>!a.clockOut)!;
  await assert.rejects(pool.query('INSERT INTO attendance(id,payload) VALUES($1,$2::jsonb)',['illegal-open',JSON.stringify({...open,id:'illegal-open'})]),(e:unknown)=>Boolean(e&&typeof e==='object'&&'constraint'in e&&e.constraint==='one_open_attendance'));
  await clock('out','fourth-out');
  // A different employee started yesterday; checkout must attach to that exact shift.
  const overnightEmployee=seed.accounts.find(a=>a.employeeId&&a.employeeId!=='emp-1')!;assert(overnightEmployee);
  const started=new Date(Date.now()-86400000).toISOString();
  await transaction(s=>{s.attendance.push({id:'overnight',employeeId:overnightEmployee.employeeId!,workDate:seoulDate(started),clockIn:started,clockOut:null,deductionMinutes:0,credited:false,reason:'overnight test',confirmed:false})});
  await transaction(s=>mutate(s,overnightEmployee,'clock',{action:'out',requestId:'overnight-out'}));
  await transaction(s=>mutate(s,overnightEmployee,'clock',{action:'in',requestId:'after-overnight-in'}));
  const overnight=(await snapshot()).attendance.filter(a=>a.employeeId===overnightEmployee.employeeId);
  assert.equal(overnight.length,2);assert.equal(overnight.find(a=>a.id==='overnight')!.workDate,seoulDate(started));assert(overnight.find(a=>a.id==='overnight')!.clockOut);assert.equal(overnight.find(a=>!a.clockOut)!.workDate,seoulDate());
  console.log('PASS DB open-shift constraint, overnight checkout and next-day re-entry');
  await assert.rejects(runner({...options,direction:'down',count:1}),/attendance_unique_day/);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM pgmigrations WHERE name='1789270000002_multiple_daily_shifts'")).rows[0].count,1);
  assert.equal((await snapshot()).attendance.length,6,'Failed rollback preserves all records');
  console.log('PASS unsafe rollback refused without data loss');
 }finally{await pool.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1});

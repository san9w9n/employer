import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import assert from 'node:assert/strict';
import { transaction } from '../src/lib/store';
import { sampleStore } from '../src/lib/sample';
async function main(){
 const databaseUrl=process.env.DATABASE_URL!;
 assert(databaseUrl && process.env.ALLOW_LOCAL_VERIFY==='true','Explicit local test database required');
 const pool=new Pool({connectionString:databaseUrl});
 const count=await pool.query('SELECT count(*) FROM accounts');
 assert.equal(Number(count.rows[0].count),0,'Verification only allowed before seed, empty accounts');
 await runner({databaseUrl,migrationsTable:'pgmigrations',dir:'migrations',direction:'down',count:Infinity});
 const absent=await pool.query("SELECT to_regclass('public.accounts') AS name");assert.equal(absent.rows[0].name,null);
 await runner({databaseUrl,migrationsTable:'pgmigrations',dir:'migrations',direction:'up',count:Infinity});
 console.log('PASS migration rollback and full reapply');
 await transaction(s=>Object.assign(s,sampleStore()));
 const before=await pool.query('SELECT count(*) FROM employees');
 await assert.rejects(transaction(s=>{s.employees.push({id:'rollback-valid',name:'롤백',username:'rollback',hireDate:'2026-01-01',payType:'hourly',active:true});s.attendance.push({id:'rollback-invalid',employeeId:'missing-foreign-key',workDate:'2026-01-01',clockIn:'2026-01-01T01:00:00.000Z',clockOut:null,deductionMinutes:120,credited:false,reason:'FK failure',confirmed:false});}),/foreign key/);
 const after=await pool.query('SELECT count(*) FROM employees');assert.equal(after.rows[0].count,before.rows[0].count);
 assert.equal((await pool.query("SELECT id FROM employees WHERE id='rollback-valid'")).rowCount,0);
 console.log('PASS real PostgreSQL constraint failure rolls back previous employee insert');
 await pool.end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});

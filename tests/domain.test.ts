import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {minutes,payrollFor,periodAt,seoulDate} from '../src/lib/domain';
import {authenticate,login,mutate,state,AppError} from '../src/lib/service';
import {sampleStore} from '../src/lib/sample';
import {transaction} from '../src/lib/store';
import type {Attendance} from '../src/lib/types';
const record=(overrides:Partial<Attendance>={}):Attendance=>({id:'a',employeeId:'emp-1',workDate:'2026-09-01',clockIn:'2026-09-01T01:00:00Z',clockOut:'2026-09-01T13:00:00Z',deductionMinutes:120,credited:false,reason:'기본',confirmed:false,...overrides});
test('default deduction, replacement split deduction and non-cumulative credit',()=>{assert.equal(minutes(record()).calculatedMinutes,600);assert.equal(minutes(record({credited:true})).calculatedMinutes,660);assert.equal(minutes(record({deductionMinutes:240})).calculatedMinutes,480);assert.equal(minutes(record({clockOut:null})).calculatedMinutes,null);assert.ok(minutes(record({clockOut:'2026-09-01T02:00:00Z'})).calculationError);assert.ok(minutes(record({deductionMinutes:0,credited:true})).calculationError);});
test('Seoul work date keeps overnight rate anchored to clock-in date',()=>{assert.equal(seoulDate('2026-09-01T16:00:00Z'),'2026-09-02');const wages=[{id:'1',employeeId:'emp-1',amount:10000,effectiveDate:'2026-09-01'},{id:'2',employeeId:'emp-1',amount:12000,effectiveDate:'2026-09-02'}];const result=payrollFor('emp-1','hourly',[record({clockIn:'2026-09-01T13:00:00Z',clockOut:'2026-09-01T17:00:00Z'}),record({id:'b',workDate:'2026-09-02'})],wages,[],'2026-09-03');assert.equal(result.amount,140000);});
test('monthly excludes monetary calculation; incomplete and missing wages excluded',()=>{const rows=[record(),record({id:'b',clockOut:null})];assert.equal(payrollFor('emp-1','monthly',rows,[],[],'2026-09-03').amount,null);assert.equal(payrollFor('emp-1','hourly',rows,[],[],'2026-09-03').excluded,2);});
test('period boundaries cover leap years, year changes and transition periods without gaps',()=>{assert.deepEqual(periodAt([],'e','2024-02-29'),{periodStart:'2024-02-01',periodEnd:'2024-02-29',nextStart:'2024-03-01'});const history=[{id:'1',employeeId:'e',startDay:21,effectiveDate:'2024-01-01'}];assert.equal(periodAt(history,'e','2024-12-31').periodEnd,'2025-01-20');assert.equal(periodAt(history,'e','2024-01-01').periodEnd,'2024-01-20');assert.equal(periodAt(history,'e','2024-01-21').periodStart,'2024-01-21');});
test('server filters employees, audits, wages and never includes payroll for staff',()=>{const s=sampleStore();const user=s.accounts[1];const view=state(s,user,new URLSearchParams());assert.ok(!('payroll' in view));assert.deepEqual(view.employees.map(e=>e.id),['emp-1']);assert.ok(view.wageHistory.every(w=>w.employeeId==='emp-1'));for(const endpoint of ['employees','attendance','wages','periods','payroll'])assert.throws(()=>mutate(s,user,endpoint,{}),e=>e instanceof AppError&&e.status===403);});
test('clock retries are idempotent; short actual checkout persists for correction',()=>{const s=sampleStore();s.attendance=[];const user=s.accounts[1];const first=mutate(s,user,'clock',{action:'in',requestId:'in-1'});assert.deepEqual(mutate(s,user,'clock',{action:'in',requestId:'in-1'}),first);assert.equal(s.attendance.length,1);assert.throws(()=>mutate(s,user,'clock',{action:'in',requestId:'in-2'}));mutate(s,user,'clock',{action:'out',requestId:'out-1'});assert.ok(s.attendance[0].clockOut);assert.ok(minutes(s.attendance[0]).calculationError);assert.deepEqual(mutate(s,user,'clock',{action:'out',requestId:'out-1'}),(s.requests.at(-1)!).result);assert.equal(s.audits.length,2);});
test('owner edits have audits; repeated credited=true does not accumulate and edits unconfirm',()=>{const s=sampleStore();s.attendance=[record({confirmed:true})];const owner=s.accounts[0];const body={...s.attendance[0],credited:true,reason:'브레이크 응대',confirmed:true};mutate(s,owner,'attendance',body);assert.equal(s.attendance[0].confirmed,false);mutate(s,owner,'attendance',{...body,confirmed:true});assert.equal(s.attendance[0].confirmed,true);assert.equal(minutes(s.attendance[0]).calculatedMinutes,660);assert.equal(s.audits.length,2);assert.equal((s.audits[0].before as Attendance).credited,false);mutate(s,owner,'attendance',{...body,deductionMinutes:180});assert.equal(s.attendance[0].confirmed,false);});
test('deactivated employees lose session access and login',()=>{const s=sampleStore();const result=login(s,{username:'employee',password:'demo1234'});assert.equal(authenticate(s,result.token).employeeId,'emp-1');s.employees[0].active=false;assert.throws(()=>authenticate(s,result.token));assert.throws(()=>login(s,{username:'employee',password:'demo1234'}));});
test('demo transaction rollback leaves no partial data; serialized concurrent updates persist',async()=>{process.env.DEMO_MODE='true';const dir=await mkdtemp(path.join(tmpdir(),'onshift-domain-'));process.env.DEMO_DATA_PATH=path.join(dir,'store.json');await transaction(()=>{});const before=await readFile(process.env.DEMO_DATA_PATH,'utf8');await assert.rejects(transaction(s=>{s.employees[0].name='changed';throw new Error('forced failure');}));assert.equal(await readFile(process.env.DEMO_DATA_PATH,'utf8'),before);await Promise.all([transaction(s=>{s.employees[0].name='A';}),transaction(s=>{s.employees[1].name='B';})]);const result=JSON.parse(await readFile(process.env.DEMO_DATA_PATH,'utf8'));assert.equal(result.employees[0].name,'A');assert.equal(result.employees[1].name,'B');});
test('owner cannot create overlapping shifts and invalid calculations',()=>{const s=sampleStore();s.attendance=[record()];const body={...record({id:'new',workDate:'2026-09-02',clockIn:'2026-09-01T12:00:00Z',clockOut:'2026-09-01T16:00:00Z'}),id:undefined};assert.throws(()=>mutate(s,s.accounts[0],'attendance',body));assert.throws(()=>mutate(s,s.accounts[0],'attendance',{...record(),deductionMinutes:-1}));assert.throws(()=>mutate(s,s.accounts[0],'attendance',{...record(),deductionMinutes:0,credited:true}));});
test('period changes must preserve earlier periods and start at an existing future boundary',()=>{const s=sampleStore();const now=new Date();const next=new Date(Date.UTC(now.getUTCFullYear()+1,0,1)).toISOString().slice(0,10);assert.throws(()=>mutate(s,s.accounts[0],'periods',{employeeId:'emp-1',startDay:21,effectiveDate:next.slice(0,8)+'02'}));mutate(s,s.accounts[0],'periods',{employeeId:'emp-1',startDay:21,effectiveDate:next});assert.equal(periodAt(s.periodHistory,'emp-1',next).periodEnd,next.slice(0,8)+'20');assert.equal(periodAt(s.periodHistory,'emp-1',next.slice(0,8)+'21').periodStart,next.slice(0,8)+'21');});
test('29th, 30th and 31st boundaries clamp to month end, including leap years',()=>{
 for(const startDay of [29,30,31]){
  const history=[{id:'p',employeeId:'e',startDay,effectiveDate:'2020-01-01'}];
  assert.equal(periodAt(history,'e','2024-02-29').periodStart,'2024-02-29');
  assert.equal(periodAt(history,'e','2025-02-28').periodStart,'2025-02-28');
  assert.equal(periodAt(history,'e','2025-02-27').periodEnd,'2025-02-27');
  const aprilBoundary=startDay===31?'2025-04-30':`2025-04-${startDay}`;
  assert.equal(periodAt(history,'e',aprilBoundary).periodStart,aprilBoundary);
  // Every represented period ends immediately before its successor starts.
  for(const date of ['2024-02-01','2024-02-29','2025-02-28','2025-04-30','2025-12-31']){
   const p=periodAt(history,'e',date);assert.ok(p.periodStart<=date&&p.periodEnd>=date);
   assert.equal(periodAt(history,'e',p.nextStart).periodStart,p.nextStart);
   assert.equal(Date.parse(p.nextStart)-Date.parse(p.periodEnd),86400000);
  }
 }
});
test('payroll rounds exact integer milliseconds directly to daily won, without minute rounding',()=>{
 const wages=[{id:'w',employeeId:'emp-1',amount:10000000,effectiveDate:'2020-01-01'}];
 const a=record({deductionMinutes:0,clockOut:'2026-09-01T01:00:00.001Z'});
 const result=payrollFor('emp-1','hourly',[a],wages,[],'2026-09-01');
 assert.equal(result.amount,3);assert.equal(result.minutes,1/60000);
 const half=record({deductionMinutes:0,clockOut:'2026-09-01T01:00:00.180Z'});
 assert.equal(payrollFor('emp-1','hourly',[half],[{...wages[0],amount:10000}],[],'2026-09-01').amount,1);
});
test('explicit demo seed can initialize an empty file and does not overwrite existing data',async()=>{
 process.env.DEMO_MODE='true';const dir=await mkdtemp(path.join(tmpdir(),'onshift-seed-'));process.env.DEMO_DATA_PATH=path.join(dir,'seed.json');
 await transaction(s=>{assert.equal(s.accounts.length,0);Object.assign(s,sampleStore());},{initializeDemo:false});
 const first=await readFile(process.env.DEMO_DATA_PATH,'utf8');
 await assert.rejects(transaction(s=>{if(s.accounts.length)throw new Error('Non-empty database');Object.assign(s,sampleStore());},{initializeDemo:false}));
 assert.equal(await readFile(process.env.DEMO_DATA_PATH,'utf8'),first);
});
test('Vercel refuses file-backed demo transactions',async()=>{
 const previous=process.env.VERCEL;process.env.VERCEL='1';process.env.DEMO_MODE='true';
 try{await assert.rejects(transaction(()=>{}),/local-only/);}finally{if(previous===undefined)delete process.env.VERCEL;else process.env.VERCEL=previous;}
});
test('owner rejects future check-in and checkout before creating actual attendance',()=>{
 const s=sampleStore();s.attendance=[];const now=Date.now();const past=new Date(now-86400000).toISOString();const future=new Date(now+3600000).toISOString();
 for(const times of [{clockIn:past,clockOut:future},{clockIn:future,clockOut:null}]){
  assert.throws(()=>mutate(s,s.accounts[0],'attendance',{...record(),id:undefined,...times}),/미래/);
  assert.equal(s.attendance.length,0);assert.equal(s.audits.length,0);
 }
});
test('clock-in defensively rejects an overlapping imported future checkout',()=>{
 const s=sampleStore();const now=Date.now();const past=new Date(now-86400000).toISOString();
 s.attendance=[record({clockIn:past,clockOut:new Date(now+3600000).toISOString(),workDate:seoulDate(past)})];
 assert.throws(()=>mutate(s,s.accounts[1],'clock',{action:'in',requestId:'overlap-import'}),/겹치는/);
 assert.equal(s.attendance.length,1);assert.equal(s.requests.length,0);assert.equal(s.audits.length,0);
});
test('future imported open check-in cannot save checkout before its start',()=>{
 const s=sampleStore();const future=new Date(Date.now()+3600000).toISOString();s.attendance=[record({clockIn:future,clockOut:null,workDate:seoulDate(future)})];
 assert.throws(()=>mutate(s,s.accounts[1],'clock',{action:'out',requestId:'future-import'}),/현재보다 늦습니다/);
 assert.equal(s.attendance[0].clockOut,null);assert.equal(s.requests.length,0);assert.equal(s.audits.length,0);
});

test('multiple clock cycles on one Seoul day keep separate records and retry results',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-01T01:00:00Z')});
 const s=sampleStore();s.attendance=[];const user=s.accounts[1];
 const first=mutate(s,user,'clock',{action:'in',requestId:'first-in'});
 t.mock.timers.setTime(Date.parse('2026-09-01T05:00:00Z'));
 const checkout=mutate(s,user,'clock',{action:'out',requestId:'first-out'});
 mutate(s,user,'clock',{action:'in',requestId:'second-in'});
 assert.deepEqual(mutate(s,user,'clock',{action:'in',requestId:'first-in'}),first);
 assert.deepEqual(mutate(s,user,'clock',{action:'out',requestId:'first-out'}),checkout);
 assert.equal(s.attendance[1].clockOut,null);
 assert.throws(()=>mutate(s,user,'clock',{action:'in',requestId:'duplicate-open'}),/이미 출근/);
 t.mock.timers.setTime(Date.parse('2026-09-01T17:00:00Z'));
 mutate(s,user,'clock',{action:'out',requestId:'second-out'});
 assert.equal(s.attendance.length,2);
 assert.ok(s.attendance.every(a=>a.workDate==='2026-09-01'));
 assert.equal(s.attendance[1].clockOut,'2026-09-01T17:00:00.000Z');
 assert.equal(minutes(s.attendance[1]).calculatedMinutes,600);
 mutate(s,user,'clock',{action:'in',requestId:'next-day-in'});
 assert.equal(s.attendance[2].workDate,'2026-09-02');
});
test('owner can add and edit same-day shifts but cannot overlap an overnight shift',()=>{
 const s=sampleStore();s.attendance=[];const owner=s.accounts[0];
 const add=(clockIn:string,clockOut:string|null)=>mutate(s,owner,'attendance',{...record(),id:undefined,clockIn,clockOut,deductionMinutes:0});
 add('2026-09-01T01:00:00Z','2026-09-01T05:00:00Z');
 add('2026-09-01T05:00:00Z','2026-09-01T17:00:00Z');
 mutate(s,owner,'attendance',{...s.attendance[1],reason:'같은 날 두 번째 근무 수정'});
 assert.equal(s.attendance.length,2);
 assert.throws(()=>add('2026-09-01T16:00:00Z','2026-09-01T18:00:00Z'),/겹칩니다/);
 add('2026-09-01T17:00:00Z',null);
 assert.throws(()=>add('2026-09-02T01:00:00Z',null),/퇴근하지 않은/);
});
test('multiple shifts count unique work dates and round combined daily pay once',()=>{
 const a=record({deductionMinutes:0,clockOut:'2026-09-01T01:00:00.180Z'});
 const b=record({id:'b',deductionMinutes:0,clockIn:'2026-09-01T02:00:00Z',clockOut:'2026-09-01T02:00:00.180Z'});
 const result=payrollFor('emp-1','hourly',[a,b],[{id:'w',employeeId:'emp-1',amount:10000,effectiveDate:'2020-01-01'}],[],'2026-09-01');
 assert.equal(result.days,1);assert.equal(result.amount,1);assert.equal(result.minutes,0.006);
});
test('month-end overnight checkout remains in the original payroll period and wage',()=>{
 const a=record({workDate:'2026-08-31',clockIn:'2026-08-31T13:00:00Z',clockOut:'2026-08-31T17:00:00Z',deductionMinutes:0});
 const wages=[{id:'old',employeeId:'emp-1',amount:10000,effectiveDate:'2026-08-01'},{id:'new',employeeId:'emp-1',amount:20000,effectiveDate:'2026-09-01'}];
 assert.equal(payrollFor('emp-1','hourly',[a],wages,[],'2026-08-31').amount,40000);
 assert.equal(payrollFor('emp-1','hourly',[a],wages,[],'2026-09-01').days,0);
});

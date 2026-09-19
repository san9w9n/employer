import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceResetRange,seoulDate} from '../src/lib/domain';
import {AppError,mutate,tokenHash} from '../src/lib/service';
import {sampleStore} from '../src/lib/sample';
import type {Attendance,Store} from '../src/lib/types';
const row=(overrides:Partial<Attendance>={}):Attendance=>({id:'a',employeeId:'emp-1',workDate:'2026-09-01',clockIn:'2026-09-01T13:00:00Z',clockOut:'2026-09-01T17:00:00Z',deductionMinutes:120,credited:false,reason:'기본',confirmed:false,...overrides});
const preview=(s:Store,scope='today')=>mutate(s,s.accounts[0],'attendance-reset-preview',{scope}) as {token:string;count:number;employeeCount:number;openCount:number;confirmedCount:number};
const reset=(s:Store,token:string,scope='today',requestId='reset-1')=>mutate(s,s.accounts[0],'attendance-reset',{scope,token,confirmed:true,requestId});
const status=(expected:number)=>(error:unknown)=>error instanceof AppError&&error.status===expected;

test('reset ranges use Seoul midnight, Monday weeks, leap months and year boundaries',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-01T14:59:59Z')});
 assert.deepEqual(attendanceResetRange('today'),{start:'2026-09-01',end:'2026-09-01'});
 t.mock.timers.setTime(Date.parse('2026-09-01T15:00:00Z'));
 assert.deepEqual(attendanceResetRange('today'),{start:'2026-09-02',end:'2026-09-02'});
 for(const day of ['2024-12-30','2025-01-01','2025-01-05'])assert.deepEqual(attendanceResetRange('week',day),{start:'2024-12-30',end:'2025-01-05'});
 assert.deepEqual(attendanceResetRange('week','2025-01-06'),{start:'2025-01-06',end:'2025-01-12'});
 assert.deepEqual(attendanceResetRange('month','2024-02-29'),{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(attendanceResetRange('month','2025-02-28'),{start:'2025-02-01',end:'2025-02-28'});
 assert.deepEqual(attendanceResetRange('month','2025-12-31'),{start:'2025-12-01',end:'2025-12-31'});
});
test('reset endpoints require owner, valid scope, explicit confirmation and preview token',()=>{
 const s=sampleStore();s.attendance=[row({workDate:seoulDate()})];const before=structuredClone(s);
 for(const endpoint of ['attendance-reset-preview','attendance-reset']){
  assert.throws(()=>mutate(s,s.accounts[1],endpoint,{scope:'today'}),status(403));
  assert.throws(()=>mutate(s,s.accounts[0],endpoint,{scope:'all'}),status(400));
 }
 const token=preview(s).token;
 for(const confirmed of [undefined,false,'true'])assert.throws(()=>mutate(s,s.accounts[0],'attendance-reset',{scope:'today',token,requestId:'x',confirmed}),status(400));
 assert.throws(()=>reset(s,'invalid-token'),status(409));
 assert.deepEqual(s,before);
});
test('reset includes all employees and shifts by workDate and preserves unrelated data and audits',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-01T18:00:00Z')});
 const s=sampleStore();
 s.attendance=[row(),row({id:'open-yesterday',clockOut:null}),row({id:'today',workDate:'2026-09-02',clockIn:'2026-09-01T17:00:00Z',clockOut:null}),row({id:'today-other',employeeId:'emp-2',workDate:'2026-09-02',confirmed:true}),row({id:'today-again',workDate:'2026-09-02'})];
 s.requests.push({id:'prior',accountId:s.accounts[1].id,action:'in',result:{ok:true}});
 s.audits.push({id:'prior-audit',employeeId:'emp-1',targetId:'a',actorId:s.accounts[0].id,actorName:'사장',at:new Date().toISOString(),reason:'기존 수정',before:null,after:row()});
 const before=structuredClone(s);const p=preview(s);
 assert.deepEqual({count:p.count,employeeCount:p.employeeCount,openCount:p.openCount,confirmedCount:p.confirmedCount},{count:3,employeeCount:2,openCount:1,confirmedCount:1});
 assert.deepEqual(reset(s,p.token),{ok:true,deletedCount:3});
 assert.deepEqual(s.attendance,before.attendance.slice(0,2));
 for(const key of ['employees','accounts','wageHistory','periodHistory','sessions'] as const)assert.deepEqual(s[key],before[key]);
 assert.deepEqual(s.requests[0],before.requests[0]);assert.deepEqual(s.audits[0],before.audits[0]);
 for(const removed of before.attendance.slice(2)){
  const audit=s.audits.find(a=>a.targetId===removed.id)!;assert.deepEqual(audit.before,removed);assert.equal(audit.after,null);assert.match(audit.reason,/오늘 출석부 초기화/);assert.equal(audit.actorId,s.accounts[0].id);
 }
});
test('preview detects added, deleted, changed records and date rollover without side effects',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-01T14:00:00Z')});
 for(const change of [(s:Store)=>{s.attendance.push(row({id:'new'}));},(s:Store)=>{s.attendance=[];},(s:Store)=>{s.attendance[0].reason='수정';},(s:Store)=>{s.attendance[0].confirmed=true;}]){
  const s=sampleStore();s.attendance=[row()];const p=preview(s);change(s);const before=structuredClone(s);
  assert.throws(()=>reset(s,p.token),status(409));assert.deepEqual(s,before);
 }
 const s=sampleStore();s.attendance=[];const p=preview(s);t.mock.timers.setTime(Date.parse('2026-09-01T15:00:00Z'));assert.throws(()=>reset(s,p.token),status(409));
});
test('preview is stable across row ordering and scopes select whole calendar intervals',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-01T01:00:00Z')});
 const s=sampleStore();s.attendance=[row(),row({id:'month-end',workDate:'2026-09-30'}),row({id:'week-start',workDate:'2026-08-31'}),row({id:'week-end',workDate:'2026-09-06'}),row({id:'outside',workDate:'2026-08-30'})];
 const token=preview(s,'week').token;s.attendance.reverse();assert.equal(preview(s,'week').token,token);
 assert.equal(preview(s,'week').count,3);assert.equal(preview(s,'month').count,3);
 assert.deepEqual(reset(s,token,'week'),{ok:true,deletedCount:3});assert.deepEqual(s.attendance.map(a=>a.id).sort(),['month-end','outside']);
});
test('reset retries preserve later attendance and reject request IDs used by another action',()=>{
 const s=sampleStore();s.attendance=[row({workDate:seoulDate()})];const p=preview(s);const result=reset(s,p.token);
 s.attendance.push(row({id:'new-after-reset',workDate:seoulDate()}));const before=structuredClone(s);
 assert.deepEqual(reset(s,p.token),result);assert.deepEqual(s,before);
 s.requests.push({id:tokenHash(`${s.accounts[0].id}:collision`),accountId:s.accounts[0].id,action:'in',result:{ok:true}});
 assert.throws(()=>reset(s,preview(s).token,'today','collision'),status(409));assert.equal(s.attendance.length,1);
});

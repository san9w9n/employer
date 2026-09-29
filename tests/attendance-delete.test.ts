import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleStore } from '../src/lib/sample';
import { AppError, mutate, state, tokenHash } from '../src/lib/service';
import type { Attendance, Store } from '../src/lib/types';

const row = (id: string, employeeId = 'emp-1'): Attendance => ({id, employeeId, workDate:'2026-09-01',clockIn:'2026-09-01T01:00:00Z',clockOut:'2026-09-01T13:00:00Z',deductionMinutes:120,credited:false,confirmed:true,reason:'수동 추가'});
function setup() { const s=sampleStore(); s.attendance=[row('a'),row('b','emp-2')]; return s; }
const preview=(s:Store,id='a')=>mutate(s,s.accounts[0],'attendance-delete-preview',{id}) as {token:string;record:Attendance};
const remove=(s:Store,token:string,extra={})=>mutate(s,s.accounts[0],'attendance-delete',{id:'a',token,reason:'중복 기록',confirmed:true,requestId:'delete-1',...extra});
const status=(code:number)=>(e:unknown)=>e instanceof AppError&&e.status===code;

test('individual deletion requires owner, explicit confirmation, reason and current preview',()=>{
 const s=setup(), before=structuredClone(s), p=preview(s);
 for(const endpoint of ['attendance-delete-preview','attendance-delete'])assert.throws(()=>mutate(s,s.accounts[1],endpoint,{id:'a'}),status(403));
 assert.throws(()=>remove(s,p.token,{confirmed:false}),status(400));
 assert.throws(()=>remove(s,p.token,{reason:'  '}),status(400));
 assert.throws(()=>remove(s,'wrong'),status(409));
 assert.throws(()=>preview(s,'missing'),status(404));
 assert.deepEqual(s,before);
});

test('deletion removes exactly one shift, preserves other entities, and records before image for both roles',()=>{
 const s=setup(), before=structuredClone(s), p=preview(s);
 const initial=state(s,s.accounts[0],new URLSearchParams({date:'2026-09-01'}));
 remove(s,p.token);
 assert.deepEqual(s.attendance,[before.attendance[1]]);
 for(const key of ['employees','accounts','wageHistory','periodHistory','sessions'] as const)assert.deepEqual(s[key],before[key]);
 const audit=s.audits.at(-1)!;
 assert.deepEqual(audit.before,before.attendance[0]);assert.equal(audit.after,null);assert.equal(audit.targetId,'a');assert.equal(audit.reason,'근무기록 삭제 · 중복 기록');
 const employeeView=state(s,s.accounts[1],new URLSearchParams({date:'2026-09-01'}));
 assert(!employeeView.attendance.some(a=>a.id==='a'));assert(employeeView.audits.some(a=>a.id===audit.id));
 const final=state(s,s.accounts[0],new URLSearchParams({date:'2026-09-01'}));
 assert('payroll' in initial&&'payroll' in final);
 assert(initial.payroll.find(p=>p.employeeId==='emp-1')!.minutes>final.payroll.find(p=>p.employeeId==='emp-1')!.minutes);
});

test('changed or removed records cannot be deleted with an old preview',()=>{
 const s=setup(), p=preview(s);s.attendance[0].reason='다른 사장님 수정';
 assert.throws(()=>remove(s,p.token),status(409));assert.equal(s.attendance.length,2);
 remove(s,preview(s).token);assert.throws(()=>remove(s,p.token,{requestId:'another-request'}),status(404));
});

test('response loss retries do not duplicate audit or affect replacement and other records',()=>{
 const s=setup(), p=preview(s);const result=remove(s,p.token);const auditCount=s.audits.length;
 s.attendance.push(row('new'));assert.deepEqual(remove(s,p.token),result);assert.equal(s.audits.length,auditCount);assert.equal(s.attendance.length,2);
 assert.throws(()=>remove(s,preview(s,'b').token,{id:'b'}),status(409));
 s.requests.push({id:tokenHash(`${s.accounts[0].id}:other`),accountId:s.accounts[0].id,action:'attendance-reset',result:{ok:true}});
 assert.throws(()=>remove(s,preview(s,'b').token,{id:'b',requestId:'other'}),status(409));
});

test('deleting an open shift permits a fresh clock-in without reviving the deleted shift on old retry',()=>{
 const s=setup();s.attendance=[];
 const employee=s.accounts[1];
 mutate(s,employee,'clock',{action:'in',requestId:'original'});
 const id=s.attendance[0].id;
 remove(s,preview(s,id).token,{id});
 mutate(s,employee,'clock',{action:'in',requestId:'original'});assert.equal(s.attendance.length,0);
 mutate(s,employee,'clock',{action:'in',requestId:'fresh'});assert.equal(s.attendance.length,1);assert.notEqual(s.attendance[0].id,id);
});

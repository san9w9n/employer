import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleStore } from '../src/lib/sample';
import { hashPassword } from '../src/lib/password';
import { AppError, DEFAULT_STORE, login, mutate, state } from '../src/lib/service';
import type { Account, Attendance, Store } from '../src/lib/types';
import type { payrollFor } from '../src/lib/domain';

const payrollIds = (view: object) => (view as { payroll: ReturnType<typeof payrollFor>[] }).payroll.map(p => p.employeeId);

const shift = (id: string, employeeId: string): Attendance => ({id,employeeId,workDate:'2026-09-01',clockIn:'2026-09-01T01:00:00Z',clockOut:'2026-09-01T10:00:00Z',deductionMinutes:60,credited:false,confirmed:false,reason:'수동 추가'});
const status = (code: number) => (e: unknown) => e instanceof AppError && e.status === code;

/** The sample store is the legacy (storeId-less) store; add a second store with its own owner and employee. */
function twoStores() {
 const s: Store = sampleStore();
 const owner: Account = {id:'owner-2',username:'gunsansquid',name:'사장님',role:'owner',employeeId:null,passwordHash:hashPassword('long-password-1'),storeId:'store-2',storeName:'군산오징어 청주강서점'};
 s.accounts.push(owner,{id:'account-emp-9',username:'squidstaff',name:'최하늘',role:'employee',employeeId:'emp-9',passwordHash:hashPassword('demo1234'),storeId:'store-2'});
 s.employees.push({id:'emp-9',name:'최하늘',username:'squidstaff',hireDate:'2026-09-01',payType:'hourly',active:true,storeId:'store-2'});
 s.wageHistory.push({id:'wage-emp-9',employeeId:'emp-9',amount:11000,effectiveDate:'2026-01-01'});
 s.attendance=[shift('a','emp-1'),shift('b','emp-9')];
 return { s, legacyOwner: s.accounts[0], owner };
}

test('legacy rows without a storeId stay in the original store',()=>{
 const { s, legacyOwner } = twoStores();
 const view = state(s, legacyOwner, new URLSearchParams({date:'2026-09-01'}));
 assert.deepEqual(view.store, DEFAULT_STORE);
 assert.deepEqual(view.employees.map(e=>e.id),['emp-1','emp-2','emp-3']);
 assert.deepEqual(view.attendance.map(a=>a.id),['a']);
 assert.deepEqual(payrollIds(view),['emp-1','emp-2','emp-3']);
});

test('a new store owner sees only their own store, employees, records, wages and payroll',()=>{
 const { s, owner } = twoStores();
 const view = state(s, owner, new URLSearchParams({date:'2026-09-01'}));
 assert.deepEqual(view.store,{id:'store-2',name:'군산오징어 청주강서점'});
 assert.deepEqual(view.employees.map(e=>e.id),['emp-9']);
 assert.deepEqual(view.attendance.map(a=>a.id),['b']);
 assert.deepEqual(view.wageHistory.map(w=>w.id),['wage-emp-9']);
 assert.deepEqual(payrollIds(view),['emp-9']);
 assert.ok(view.audits.every(a=>a.employeeId==='emp-9'||a.employeeId===null));
 const staff = state(s, s.accounts.find(a=>a.id==='account-emp-9')!, new URLSearchParams());
 assert.equal(staff.store.name,'군산오징어 청주강서점');
});

test('owners cannot read or change another store’s employees or records',()=>{
 const { s, owner, legacyOwner } = twoStores();
 const before = structuredClone(s);
 assert.throws(()=>mutate(s,owner,'attendance',{...shift('a','emp-1'),reason:'변경'}),status(404));
 assert.throws(()=>mutate(s,owner,'attendance',{...shift('x','emp-1'),id:undefined}),status(404));
 assert.throws(()=>mutate(s,owner,'wages',{employeeId:'emp-1',amount:1,effectiveDate:'2026-10-01'}),status(404));
 assert.throws(()=>mutate(s,owner,'periods',{employeeId:'emp-1',startDay:5,effectiveDate:'2030-01-01'}),status(404));
 assert.throws(()=>mutate(s,owner,'employees',{id:'emp-1',name:'탈취',username:'employee',hireDate:'2026-01-05',payType:'hourly',active:false}),status(404));
 assert.throws(()=>mutate(s,owner,'attendance-delete-preview',{id:'a'}),status(404));
 assert.throws(()=>mutate(s,legacyOwner,'attendance-delete-preview',{id:'b'}),status(404));
 assert.deepEqual(s,before);
});

test('reset only deletes the acting owner’s store records',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-01T12:00:00Z')});
 const { s, owner } = twoStores();
 const preview = mutate(s,owner,'attendance-reset-preview',{scope:'today'}) as {count:number;token:string};
 assert.equal(preview.count,1);
 mutate(s,owner,'attendance-reset',{scope:'today',token:preview.token,confirmed:true,requestId:'reset-1'});
 assert.deepEqual(s.attendance.map(a=>a.id),['a']);
});

test('employees registered by an owner join that owner’s store and keep global unique usernames',()=>{
 const { s, owner } = twoStores();
 mutate(s,owner,'employees',{name:'정바다',username:'sea',password:'password1',hireDate:'2026-09-02',payType:'hourly',active:true});
 const added = s.employees.find(e=>e.username==='sea')!;
 assert.equal(added.storeId,'store-2');
 assert.equal(s.accounts.find(a=>a.employeeId===added.id)!.storeId,'store-2');
 assert.throws(()=>mutate(s,owner,'employees',{name:'중복',username:'employee',password:'password1',hireDate:'2026-09-02',payType:'hourly',active:true}),status(409));
 const session = login(s,{username:'gunsansquid',password:'long-password-1'});
 assert.equal(session.user.storeId,'store-2');
});

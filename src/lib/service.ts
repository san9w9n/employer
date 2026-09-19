import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {attendanceResetRange,minutes,payrollFor,periodAt,seoulDate,validDate} from './domain';
import {hashPassword,verifyPassword} from './password';
import type {Account,Attendance,Employee,Store} from './types';
export class AppError extends Error {constructor(message:string,public status=400){super(message);}}
function assert(value:unknown,message:string,status=400):asserts value {if(!value)throw new AppError(message,status);}
function str(value:unknown,label:string,max=200){assert(typeof value==='string'&&value.trim().length>0&&value.length<=max,`${label}을 확인해 주세요.`);return value.trim();}
function date(value:unknown){assert(validDate(value),'올바른 날짜를 입력해 주세요.');return value;}
function number(value:unknown,min:number,max:number){assert(typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max,'숫자 입력 범위를 확인해 주세요.');return value;}
function instant(value:unknown){assert(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value)),'출퇴근 시간을 확인해 주세요.');return new Date(value).toISOString();}
function owner(user:Account){assert(user.role==='owner','사장님만 사용할 수 있습니다.',403);}
function employee(s:Store,id:unknown){const found=s.employees.find(e=>e.id===id);assert(found,'직원을 찾을 수 없습니다.',404);return found;}
function audit(s:Store,user:Account,targetId:string,employeeId:string|null,before:unknown,after:unknown,reason:string){s.audits.push({id:randomUUID(),targetId,employeeId,actorId:user.id,actorName:user.name,at:new Date().toISOString(),before:structuredClone(before),after:structuredClone(after),reason});}
export function tokenHash(token:string){return createHash('sha256').update(token).digest('hex');}
function resetPreview(s:Store,scope:'today'|'week'|'month') {
 const {start,end}=attendanceResetRange(scope);
 const rows=s.attendance.filter(a=>a.workDate>=start&&a.workDate<=end).sort((a,b)=>a.id.localeCompare(b.id));
 const canonicalRows=rows.map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))));
 return {scope,start,end,count:rows.length,employeeCount:new Set(rows.map(a=>a.employeeId)).size,openCount:rows.filter(a=>!a.clockOut).length,confirmedCount:rows.filter(a=>a.confirmed).length,token:tokenHash(JSON.stringify({scope,start,end,rows:canonicalRows}))};
}
export function authenticate(s:Store,token:string|undefined){assert(token,'로그인이 필요합니다.',401);const session=s.sessions.find(x=>x.id===tokenHash(token)&&Date.parse(x.expiresAt)>Date.now());assert(session,'세션이 만료되었습니다. 다시 로그인해 주세요.',401);const user=s.accounts.find(a=>a.id===session.accountId);assert(user,'로그인이 필요합니다.',401);if(user.role==='employee')assert(employee(s,user.employeeId).active,'퇴사 처리된 계정입니다.',403);return user;}
export function publicUser(user:Account){const {passwordHash:_,...safe}=user;void _;return safe;}
export function login(s:Store,body:Record<string,unknown>){const username=str(body.username,'아이디',60);const password=str(body.password,'비밀번호',200);const account=s.accounts.find(a=>a.username===username);assert(account&&verifyPassword(password,account.passwordHash),'아이디 또는 비밀번호가 맞지 않습니다.',401);if(account.role==='employee')assert(employee(s,account.employeeId).active,'퇴사 처리된 계정입니다.',403);const token=randomBytes(32).toString('hex');s.sessions=s.sessions.filter(x=>Date.parse(x.expiresAt)>Date.now());s.sessions.push({id:tokenHash(token),accountId:account.id,expiresAt:new Date(Date.now()+7*86400000).toISOString()});return {token,user:publicUser(account)};}
export function state(s:Store,user:Account,query:URLSearchParams){const all=user.role==='owner';const own=(id:string|null)=>all||id===user.employeeId;const dateValue=query.get('date')??seoulDate();assert(validDate(dateValue),'조회 날짜를 확인해 주세요.');const result={user:publicUser(user),employees:s.employees.filter(e=>own(e.id)),attendance:s.attendance.filter(a=>own(a.employeeId)).map(a=>({...a,...minutes(a)})).sort((a,b)=>b.clockIn.localeCompare(a.clockIn)),wageHistory:s.wageHistory.filter(w=>own(w.employeeId)),periodHistory:s.periodHistory.filter(p=>own(p.employeeId)),audits:s.audits.filter(a=>own(a.employeeId)).sort((a,b)=>b.at.localeCompare(a.at)),today:seoulDate()};return all?{...result,payroll:s.employees.map(e=>payrollFor(e.id,e.payType,s.attendance,s.wageHistory,s.periodHistory,dateValue))}:result;}
export function mutate(s:Store,user:Account,endpoint:string,b:Record<string,unknown>):unknown {
 if(endpoint==='clock'){
  assert(user.role==='employee','직원 계정으로 출퇴근을 기록해 주세요.',403);const action=b.action;assert(action==='in'||action==='out','출퇴근 동작을 확인해 주세요.');const key=str(b.requestId,'요청 번호',100);const requestId=tokenHash(`${user.id}:${key}`);const prior=s.requests.find(r=>r.id===requestId);if(prior){assert(prior.action===action,'다른 동작에 사용된 요청 번호입니다.',409);return prior.result;}
  const employeeId=user.employeeId!;const now=new Date().toISOString();let record=s.attendance.find(a=>a.employeeId===employeeId&&!a.clockOut);const before=record?structuredClone(record):null;
  if(action==='in'){assert(!record,'이미 출근한 기록이 있습니다.',409);assert(!s.attendance.some(a=>a.employeeId===employeeId&&a.clockOut&&Date.parse(a.clockOut)>Date.parse(now)),'현재 시간과 겹치는 기록이 있습니다. 사장님께 수정을 요청해 주세요.',409);record={id:randomUUID(),employeeId,workDate:seoulDate(now),clockIn:now,clockOut:null,deductionMinutes:120,credited:false,reason:'기본 휴게시간 2시간',confirmed:false};s.attendance.push(record);}else{assert(record,'퇴근할 출근 기록이 없습니다.',409);assert(Date.parse(record.clockIn)<=Date.parse(now),'출근 시간이 현재보다 늦습니다. 사장님께 수정을 요청해 주세요.',409);record.clockOut=now;record.confirmed=false;}
  audit(s,user,record.id,employeeId,before,record,action==='in'?'직원 출근 입력':'직원 퇴근 입력');const result={ok:true,attendance:{...record,...minutes(record)}};s.requests.push({id:requestId,accountId:user.id,action,result});return result;
 }
 if(endpoint==='password'){
  const current=str(b.currentPassword,'현재 비밀번호');assert(verifyPassword(current,user.passwordHash),'현재 비밀번호가 맞지 않습니다.',403);const password=str(b.newPassword,'새 비밀번호');assert(password.length>=8,'비밀번호는 8자 이상이어야 합니다.');user.passwordHash=hashPassword(password);s.sessions=s.sessions.filter(x=>x.accountId!==user.id);audit(s,user,user.id,user.employeeId,null,{passwordChanged:true},'비밀번호 변경');return {ok:true};
 }
 owner(user);
 if(endpoint==='attendance-reset-preview'||endpoint==='attendance-reset'){
  const scope=b.scope;assert(scope==='today'||scope==='week'||scope==='month','초기화 기간을 확인해 주세요.');
  if(endpoint==='attendance-reset-preview')return resetPreview(s,scope);
  assert(b.confirmed===true,'출석부 초기화 내용을 먼저 확인해 주세요.');
  const token=str(b.token,'확인 정보',64);const key=str(b.requestId,'요청 번호',100);const requestId=tokenHash(`${user.id}:${key}`);
  const prior=s.requests.find(r=>r.id===requestId);if(prior){assert(prior.action==='attendance-reset','다른 동작에 사용된 요청 번호입니다.',409);return prior.result;}
  const preview=resetPreview(s,scope);assert(token===preview.token,'출석부가 변경되었습니다. 초기화 대상을 다시 확인해 주세요.',409);
  const removed=s.attendance.filter(a=>a.workDate>=preview.start&&a.workDate<=preview.end);
  const labels={today:'오늘',week:'이번 주',month:'이번 달'};
  for(const row of removed)audit(s,user,row.id,row.employeeId,row,null,`${labels[scope]} 출석부 초기화 (${preview.start} ~ ${preview.end})`);
  s.attendance=s.attendance.filter(a=>a.workDate<preview.start||a.workDate>preview.end);
  const result={ok:true,deletedCount:removed.length};s.requests.push({id:requestId,accountId:user.id,action:'attendance-reset',result});return result;
 }
 if(endpoint==='attendance'){
  const e=employee(s,b.employeeId);const existing=b.id?s.attendance.find(a=>a.id===b.id):undefined;assert(!b.id||existing,'기록을 찾을 수 없습니다.',404);assert(!existing||existing.employeeId===e.id,'기록의 직원을 변경할 수 없습니다.');const before=existing?structuredClone(existing):null;
  const clockIn=instant(b.clockIn);const clockOut=b.clockOut?instant(b.clockOut):null;const currentTime=Date.now();assert(Date.parse(clockIn)<=currentTime&&(clockOut===null||Date.parse(clockOut)<=currentTime),'미래의 출퇴근 시간은 기록할 수 없습니다.');assert(clockOut===null||Date.parse(clockOut)>=Date.parse(clockIn),'퇴근은 출근보다 빨라질 수 없습니다.');assert(typeof b.credited==='boolean','근무 인정 상태를 확인해 주세요.');assert(b.confirmed===undefined||typeof b.confirmed==='boolean','확인 상태를 확인해 주세요.');
  const record:Attendance={id:existing?.id??randomUUID(),employeeId:e.id,workDate:seoulDate(clockIn),clockIn,clockOut,deductionMinutes:number(b.deductionMinutes,0,10080),credited:b.credited,reason:str(b.reason,'수정 사유',500),confirmed:false};assert(!minutes(record).calculationError,'차감·인정시간은 전체 근무시간 안에서 설정해 주세요.');assert(record.clockOut!==null||!s.attendance.some(a=>a.id!==record.id&&a.employeeId===e.id&&!a.clockOut),'퇴근하지 않은 기록이 이미 있습니다.',409);
  assert(!s.attendance.some(a=>a.id!==record.id&&a.employeeId===e.id&&Date.parse(a.clockIn)<(record.clockOut?Date.parse(record.clockOut):Infinity)&&(a.clockOut?Date.parse(a.clockOut):Infinity)>Date.parse(record.clockIn)),'다른 근무 기록과 시간이 겹칩니다.',409);
  const changed=!existing||['clockIn','clockOut','deductionMinutes','credited','reason'].some(k=>existing[k as keyof Attendance]!==record[k as keyof Attendance]);record.confirmed=changed?false:b.confirmed===undefined?existing!.confirmed:b.confirmed===true;assert(!record.confirmed||record.clockOut,'미완료 기록은 확인 완료할 수 없습니다.');if(existing)Object.assign(existing,record);else s.attendance.push(record);audit(s,user,record.id,e.id,before,record,record.reason);return {ok:true};
 }
 if(endpoint==='employees'){
  const existing=b.id?employee(s,b.id):undefined;const before=existing?structuredClone(existing):null;const name=str(b.name,'이름',60);const username=str(b.username,'아이디',60);assert(/^[a-zA-Z0-9_.-]{3,60}$/.test(username),'아이디는 영문·숫자 3자 이상으로 입력해 주세요.');assert(b.payType==='hourly'||b.payType==='monthly','급여 형태를 확인해 주세요.');assert(typeof b.active==='boolean','재직 상태를 확인해 주세요.');const account=existing?s.accounts.find(a=>a.employeeId===existing.id):undefined;assert(!s.accounts.some(a=>a.username===username&&a.id!==account?.id),'이미 사용 중인 아이디입니다.',409);const record:Employee={id:existing?.id??randomUUID(),name,username,hireDate:date(b.hireDate),payType:b.payType,active:b.active};
  if(existing)Object.assign(existing,record);else s.employees.push(record);
  if(account){Object.assign(account,{username,name});if(b.password){const password=str(b.password,'비밀번호');assert(password.length>=8,'비밀번호는 8자 이상이어야 합니다.');account.passwordHash=hashPassword(password);s.sessions=s.sessions.filter(x=>x.accountId!==account.id);}if(!record.active)s.sessions=s.sessions.filter(x=>x.accountId!==account.id);}else{const password=str(b.password,'비밀번호');assert(password.length>=8,'비밀번호는 8자 이상이어야 합니다.');s.accounts.push({id:randomUUID(),username,name,role:'employee',employeeId:record.id,passwordHash:hashPassword(password)});s.periodHistory.push({id:randomUUID(),employeeId:record.id,startDay:1,effectiveDate:record.hireDate});}
  audit(s,user,record.id,record.id,before,record,existing?'직원 계정·재직 정보 수정':'직원 등록');return {ok:true,employee:record};
 }
 if(endpoint==='wages'){
  const e=employee(s,b.employeeId);assert(e.payType==='hourly','월급제 직원은 시급을 설정하지 않습니다.');const record={id:randomUUID(),employeeId:e.id,amount:number(b.amount,1,10000000),effectiveDate:date(b.effectiveDate)};assert(!s.wageHistory.some(w=>w.employeeId===e.id&&w.effectiveDate===record.effectiveDate),'해당 적용일에 시급 이력이 이미 있습니다.',409);s.wageHistory.push(record);audit(s,user,record.id,e.id,null,record,'시급 적용 이력 등록');return {ok:true};
 }
 if(endpoint==='periods'){
  const e=employee(s,b.employeeId);const effectiveDate=date(b.effectiveDate);const startDay=number(b.startDay,1,31);const latest=s.periodHistory.filter(p=>p.employeeId===e.id).sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate))[0];assert(!latest||effectiveDate>latest.effectiveDate,'가장 최근 적용일 이후로 설정해 주세요.');assert(effectiveDate>seoulDate(),'이전 기간을 유지하도록 다음 산정기간부터 변경해 주세요.');const prior=periodAt(s.periodHistory,e.id,effectiveDate);assert(prior.periodStart===effectiveDate,'적용 시작일은 기존 산정기간의 시작일이어야 합니다.');const record={id:randomUUID(),employeeId:e.id,startDay,effectiveDate};s.periodHistory.push(record);audit(s,user,record.id,e.id,null,record,'급여 산정기간 변경');return {ok:true};
 }
 throw new AppError('요청한 기능을 찾을 수 없습니다.',404);
}

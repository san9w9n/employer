import type {Attendance,Period,Wage} from './types';
export function seoulDate(value:Date|string = new Date()):string { return new Date(new Date(value).getTime()+9*3600000).toISOString().slice(0,10); }
export function validDate(s:unknown):s is string {return typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;}
export function attendanceResetRange(scope:'today'|'week'|'month',today=seoulDate()) {
 const current=new Date(`${today}T00:00:00Z`);
 if(scope==='today')return {start:today,end:today};
 if(scope==='week'){
  const monday=current.getTime()-((current.getUTCDay()+6)%7)*86400000;
  return {start:new Date(monday).toISOString().slice(0,10),end:new Date(monday+6*86400000).toISOString().slice(0,10)};
 }
 return {start:`${today.slice(0,7)}-01`,end:new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()+1,0)).toISOString().slice(0,10)};
}
export function paidMilliseconds(a:Attendance):number|null {
 if (!a.clockOut) return null;
 const elapsed=Date.parse(a.clockOut)-Date.parse(a.clockIn);
 const paid=elapsed-a.deductionMinutes*60000+(a.credited?3600000:0);
 return !Number.isFinite(paid)||elapsed<0||paid<0||paid>elapsed?null:paid;
}
export function minutes(a:Attendance):{calculatedMinutes:number|null;calculationError:string|null} {
 const paid=paidMilliseconds(a);
 return {calculatedMinutes:paid===null?null:paid/60000,calculationError:a.clockOut&&paid===null?'차감·인정시간 보정 필요':null};
}
export function wageAt(wages:Wage[],employeeId:string,date:string) {return wages.filter(w=>w.employeeId===employeeId&&w.effectiveDate<=date).sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate))[0]?.amount;}
function shiftMonth(date:string,offset:number,day:number) {
 const d=new Date(`${date}T00:00:00Z`);
 const month=d.getUTCMonth()+offset;
 const lastDay=new Date(Date.UTC(d.getUTCFullYear(),month+1,0)).getUTCDate();
 return new Date(Date.UTC(d.getUTCFullYear(),month,Math.min(day,lastDay))).toISOString().slice(0,10);
}
export function previousDay(date:string) {return new Date(Date.parse(date)-86400000).toISOString().slice(0,10);}
// A changed schedule starts at an existing boundary. Its first period is a
// transition period ending at the next new monthly boundary, preventing gaps.
export function periodAt(history:Period[],employeeId:string,date:string) {
 const rows=history.filter(p=>p.employeeId===employeeId).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
 const current=rows.filter(p=>p.effectiveDate<=date).at(-1);
 const day=current?.startDay??1;
 const beforeBoundary=date<shiftMonth(date,0,day);
 let start=shiftMonth(date,beforeBoundary?-1:0,day);
 if(current&&start<current.effectiveDate)start=current.effectiveDate;
 let next=shiftMonth(date,beforeBoundary?0:1,day);
 const future=rows.find(p=>p.effectiveDate>date);
 if(future&&future.effectiveDate<next)next=future.effectiveDate;
 return {periodStart:start,periodEnd:previousDay(next),nextStart:next};
}
export function payrollFor(employeeId:string,payType:string,attendance:Attendance[],wages:Wage[],periods:Period[],date:string) {
 const period=periodAt(periods,employeeId,date);
 const records=attendance.filter(a=>a.employeeId===employeeId&&a.workDate>=period.periodStart&&a.workDate<=period.periodEnd);
 let totalMilliseconds=0,amount=0,excluded=0;const rates=new Set<number>();const dailyPay=new Map<string,bigint>();
 for(const a of records){const ms=paidMilliseconds(a);const rate=wageAt(wages,employeeId,a.workDate);if(ms===null||(payType==='hourly'&&rate===undefined)){excluded++;continue;}totalMilliseconds+=ms;if(payType==='hourly'){rates.add(rate!);dailyPay.set(a.workDate,(dailyPay.get(a.workDate)??0n)+BigInt(ms)*BigInt(rate!));}}
 for(const pay of dailyPay.values())amount+=Number((pay+1800000n)/3600000n);
 return {employeeId,...period,days:new Set(records.map(a=>a.workDate)).size,minutes:totalMilliseconds/60000,amount:payType==='monthly'?null:amount,unconfirmed:records.filter(a=>!a.confirmed).length,incomplete:records.filter(a=>!a.clockOut).length,excluded,rates:[...rates]};
}

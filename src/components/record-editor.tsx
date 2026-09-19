'use client';
import {useState} from 'react';
import {minutes, seoulDate} from '@/lib/domain';
import type {Attendance, Employee} from '@/lib/types';

const localTime=(value:string)=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16);
const localExact=(value:string)=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,-1);
const duration=(value:number)=>`${Math.floor(Math.round(value)/60)}시간 ${Math.round(value)%60}분`;

export function RecordEditor({record,employeeId,employees,busy}:{record?:Attendance;employeeId?:string;employees:Employee[];busy:boolean}) {
 const [clockIn,setClockIn]=useState(record?localTime(record.clockIn):`${seoulDate()}T10:00`);
 const [clockOut,setClockOut]=useState(record?.clockOut?localTime(record.clockOut):'');
 const [deduction,setDeduction]=useState(String(record?.deductionMinutes??120));
 const [credited,setCredited]=useState(record?.credited??false);
 const [reason,setReason]=useState(record?.reason??'');
 // Preserve saved seconds when only another field is edited.
 const inValue=record&&clockIn===localTime(record.clockIn)?localExact(record.clockIn):clockIn;
 const outValue=record?.clockOut&&clockOut===localTime(record.clockOut)?localExact(record.clockOut):clockOut;
 const inMs=Date.parse(`${inValue}+09:00`),outMs=Date.parse(`${outValue}+09:00`);
 const complete=Number.isFinite(inMs)&&Number.isFinite(outMs);
 const paid=complete?minutes({clockIn:new Date(inMs).toISOString(),clockOut:new Date(outMs).toISOString(),deductionMinutes:Number(deduction),credited} as Attendance):null;
 const invalid=complete&&(outMs<inMs||Boolean(paid?.calculationError));
 function checkoutDay(next:boolean){
  if(!clockIn)return;
  const date=new Date(Date.parse(`${clockIn.slice(0,10)}T00:00:00Z`)+(next?86400000:0)).toISOString().slice(0,10);
  setClockOut(`${date}T${clockOut.slice(11)||(next?'02:00':'22:00')}`);
 }
 return <fieldset className="record-editor" disabled={busy}>
  <label className="field"><span>직원</span><select aria-label="직원" name={record?undefined:'employeeId'} defaultValue={record?.employeeId||employeeId||employees[0]?.id} disabled={Boolean(record)} required>{employees.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
  {record&&<input type="hidden" name="employeeId" value={record.employeeId}/>}
  <div className="editor-section-title"><b>출퇴근 시간</b><span>한국 시각 · 출근일 기준</span></div>
  <div className="form-grid">
   <label className="field"><span>출근 · 한국 시각</span><input type="datetime-local" value={clockIn} onChange={e=>setClockIn(e.target.value)} required/></label>
   <label className="field"><span>퇴근 · 미퇴근은 비워 두세요</span><input type="datetime-local" value={clockOut} onChange={e=>setClockOut(e.target.value)}/></label>
  </div>
  <input type="hidden" name="clockIn" value={inValue}/><input type="hidden" name="clockOut" value={outValue}/>
  <div className="quick-options" aria-label="퇴근 날짜 빠른 설정">
   <button type="button" disabled={!clockIn} onClick={()=>checkoutDay(false)}>출근 당일 퇴근</button>
   <button type="button" disabled={!clockIn} onClick={()=>checkoutDay(true)}>다음 날 퇴근</button>
   <button type="button" onClick={()=>setClockOut('')}>미퇴근으로 설정</button>
  </div>
  {clockOut&&clockOut.slice(0,10)>clockIn.slice(0,10)&&<p className="editor-hint">익일 이후 퇴근 · {clockIn.slice(0,10)} 출근 기록으로 저장됩니다.</p>}
  <div className="editor-section-title"><b>휴게·인정시간</b><span>이 근무 기록에만 적용</span></div>
  <label className="field"><span>총 차감시간 (분)</span><input name="deductionMinutes" type="number" inputMode="numeric" min="0" max="10080" step="1" value={deduction} onChange={e=>setDeduction(e.target.value)} required/></label>
  <div className="quick-options" aria-label="휴게시간 빠른 선택">{[0,30,60,120].map(n=><button type="button" key={n} aria-pressed={deduction===String(n)} onClick={()=>setDeduction(String(n))}>{n===0?'차감 없음':`${n}분`}</button>)}</div>
  <label className="checkbox-field"><input type="checkbox" name="credited" checked={credited} onChange={e=>setCredited(e.target.checked)}/><div><b>근무 1시간 인정</b><span>차감시간 중 1시간을 근무로 인정</span></div></label>
  <div className={`calculation-preview${invalid?' invalid':''}`} aria-live="polite">
   <span>저장 후 계산시간</span><strong>{!clockOut?'미퇴근':invalid?'시간 확인 필요':paid?.calculatedMinutes!=null?duration(paid.calculatedMinutes):'시간을 입력해 주세요'}</strong>
   <p>{!clockOut?'퇴근 기록을 입력하면 계산됩니다.':outMs<inMs?'퇴근이 출근보다 빠릅니다. 새벽 퇴근은 ‘다음 날 퇴근’을 선택해 주세요.':invalid?'휴게·인정시간이 전체 근무시간을 벗어납니다.':complete?`전체 ${duration((outMs-inMs)/60000)} − 차감 ${deduction||0}분 + 인정 ${credited?60:0}분`:''}</p>
  </div>
  <label className="field"><span>수정 사유</span><textarea name="reason" value={reason} onChange={e=>setReason(e.target.value)} placeholder="직접 입력하거나 아래 사유를 선택하세요" required rows={2}/></label>
  <div className="quick-options" aria-label="수정 사유 빠른 선택">{['출퇴근 시간 정정','퇴근 누락 보정','휴게시간 조정'].map(text=><button type="button" key={text} onClick={()=>setReason(text)}>{text}</button>)}</div>
  <p className="editor-hint">저장하면 확인 전으로 변경되며, 이전 기록과 수정 사유가 조정 내역에 남습니다.</p>
 </fieldset>;
}

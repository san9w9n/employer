'use client';
import {useEffect,useRef,useState} from 'react';
export type ResetScope='today'|'week'|'month';
type Preview={scope:ResetScope;start:string;end:string;count:number;employeeCount:number;openCount:number;confirmedCount:number;token:string};
export const resetLabels:Record<ResetScope,string>={today:'오늘',week:'이번 주',month:'이번 달'};

export function AttendanceResetDialog({scope,busy,onBusy,onClose,onComplete}:{scope:ResetScope;busy:boolean;onBusy:(value:boolean)=>void;onClose:()=>void;onComplete:(count:number)=>void}){
 const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const requestId=useRef('');const submitting=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setPreview(null);setError('');requestId.current=crypto.randomUUID();
  void fetch('/api/attendance-reset-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope}),signal:controller.signal})
   .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'삭제 대상을 불러오지 못했습니다.');if(!controller.signal.aborted)setPreview(data)})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'삭제 대상을 불러오지 못했습니다.')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[scope,revision]);
 async function reset(){
  if(!preview||!preview.count||submitting.current)return;
  submitting.current=true;onBusy(true);setError('');
  try{
   const response=await fetch('/api/attendance-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,token:preview.token,confirmed:true,requestId:requestId.current})});
   const data=await response.json();
   if(!response.ok){if(response.status===409)setPreview(null);throw Error(data.error||'초기화하지 못했습니다.');}
   onComplete(data.deletedCount);
  }catch(e){setError(e instanceof Error?e.message:'통신 오류가 발생했습니다. 같은 요청으로 다시 시도해 주세요.');}
  finally{submitting.current=false;onBusy(false);}
 }
 return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}><section className="modal reset-dialog" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="modal-title" aria-describedby="reset-description">
  <header><div><span className="eyebrow">출석부 초기화</span><h2 id="modal-title">{resetLabels[scope]} 기록을 삭제할까요?</h2></div><button aria-label="닫기" disabled={busy} onClick={onClose}>✕</button></header>
  <div className="modal-body">
   <p id="reset-description">현재 조회 필터와 관계없이 <b>전체 직원</b>의 해당 기간 출석 기록을 삭제합니다.</p>
   {loading&&<p role="status" className="editor-hint">삭제 대상을 확인하고 있습니다…</p>}
   {preview&&<><dl className="reset-summary"><div><dt>출근일 기준 기간</dt><dd>{preview.start} ~ {preview.end}</dd></div><div><dt>삭제 대상</dt><dd><strong>{preview.count}건</strong> · {preview.employeeCount}명</dd></div><div><dt>미퇴근 / 확인 완료</dt><dd>{preview.openCount}건 / {preview.confirmedCount}건</dd></div></dl>
    {preview.count>0?<div className="reset-warning"><b>삭제 후 화면에서 되돌릴 수 없습니다.</b><p>급여 집계에서도 제외됩니다. 삭제 전 기록은 조정 내역에 남으며, 직원 정보와 시급 설정은 유지됩니다.</p>{preview.openCount>0&&<p>미퇴근 {preview.openCount}건도 삭제됩니다. 해당 직원은 다시 출근해야 합니다.</p>}</div>:<p className="editor-hint">이 기간에는 초기화할 출석 기록이 없습니다.</p>}
    <p className="editor-hint">한국 시간 기준 · 이번 주는 월~일 · 익일 퇴근도 출근일에 포함됩니다.</p></>}
   {error&&<div className="error" role="alert">{error}</div>}
   {!preview&&!loading&&<button className="secondary" onClick={()=>setRevision(n=>n+1)}>삭제 대상 다시 확인</button>}
  </div>
  <div className="modal-footer"><button className="secondary" disabled={busy} onClick={onClose}>취소</button><button className="danger-button" disabled={busy||loading||!preview?.count} onClick={()=>void reset()}>{busy?'초기화 중…':`확인 후 ${preview?.count??0}건 삭제`}</button></div>
 </section></div>;
}

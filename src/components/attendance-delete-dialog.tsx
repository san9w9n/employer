"use client";
import { useEffect, useRef, useState } from "react";
import type { Attendance } from "@/lib/types";

type Preview = { record: Attendance; employeeName: string; token: string };
const localTime = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value));

export function AttendanceDeleteDialog({ id, busy, onBusy, onClose, onComplete }: {
  id: string; busy: boolean; onBusy: (value: boolean) => void;
  onClose: () => void; onComplete: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const requestId = useRef("");
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setPreview(null); setError(""); requestId.current = crypto.randomUUID();
    void fetch("/api/attendance-delete-preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }), signal: controller.signal,
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "삭제 대상을 확인하지 못했습니다.");
      if (!controller.signal.aborted) setPreview(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "연결을 확인해 주세요."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || submitting.current) return;
    submitting.current = true; onBusy(true); setError("");
    try {
      const response = await fetch("/api/attendance-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, token: preview.token, reason, confirmed: true, requestId: requestId.current }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status === 404) setPreview(null);
        throw Error(data.error || "기록을 삭제하지 못했습니다.");
      }
      onComplete();
    } catch (e) { setError(e instanceof TypeError ? "통신에 실패했습니다. 연결을 확인하고 다시 시도해 주세요." : e instanceof Error ? e.message : "연결을 확인하고 다시 시도해 주세요."); }
    finally { submitting.current = false; onBusy(false); }
  }

  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="modal reset-dialog" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="modal-title" aria-describedby="delete-description">
      <header><div><span className="eyebrow">근무기록 1건 삭제</span><h2 id="modal-title">이 기록을 삭제할까요?</h2></div><button aria-label="닫기" disabled={busy} onClick={onClose}>✕</button></header>
      <form onSubmit={remove}>
        <div className="modal-body">
          <p id="delete-description">아래 근무기록 1건만 삭제합니다. 같은 날짜의 다른 기록은 유지됩니다.</p>
          {loading && <p role="status">삭제할 기록을 확인하고 있습니다…</p>}
          {preview && <>
            <dl className="reset-summary">
              <div><dt>직원 / 근무일</dt><dd>{preview.employeeName} · {preview.record.workDate}</dd></div>
              <div><dt>출근</dt><dd>{localTime(preview.record.clockIn)}</dd></div>
              <div><dt>퇴근</dt><dd>{preview.record.clockOut ? localTime(preview.record.clockOut) : "미퇴근 · 근무 중"}</dd></div>
            </dl>
            <div className="reset-warning"><b>삭제하면 급여 집계에서도 제외됩니다.</b><p>화면에서 되돌릴 수 없습니다. 삭제 전 기록과 삭제 사유는 조정 내역에 남습니다.</p>{!preview.record.clockOut && <p>현재 출근 상태도 해제됩니다. 해당 직원은 다시 출근해야 합니다.</p>}</div>
            <label className="field"><span>삭제 사유</span><textarea value={reason} onChange={e => setReason(e.target.value)} required maxLength={500} rows={2} disabled={busy} placeholder="예: 중복 입력된 기록" /></label>
          </>}
          {error && <div className="error" role="alert">{error}</div>}
          {!preview && !loading && <button type="button" className="secondary" onClick={() => setRevision(n => n + 1)}>삭제 대상 다시 확인</button>}
        </div>
        <div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>취소</button><button type="submit" className="danger-button" disabled={busy || loading || !preview || !reason.trim()}>{busy ? "삭제 중…" : "이 기록 삭제"}</button></div>
      </form>
    </section>
  </div>;
}

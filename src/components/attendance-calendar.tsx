"use client";

import { useRef, type KeyboardEvent } from "react";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function AttendanceCalendar({ value, month, today, counts, onChange, onMonthChange }: {
  value: string;
  month: string;
  today: string;
  counts: Map<string, number>;
  onChange: (date: string) => void;
  onMonthChange: (month: string) => void;
}) {
  const calendar = useRef<HTMLDivElement>(null);
  const first = new Date(`${month}-01T00:00:00Z`);
  const year = first.getUTCFullYear();
  const monthIndex = first.getUTCMonth();
  const offset = first.getUTCDay();
  const last = new Date(first);
  last.setUTCMonth(monthIndex + 1, 0);
  const days = last.getUTCDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  const tabDate = value.startsWith(month) ? value : `${month}-01`;

  function moveMonth(delta: number) {
    const next = new Date(first);
    next.setUTCMonth(monthIndex + delta, 1);
    onMonthChange(dateKey(next).slice(0, 7));
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const current = new Date(`${date}T00:00:00Z`);
    const changes: Record<string, number> = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
      Home: -current.getUTCDay(), End: 6 - current.getUTCDay(),
    };
    if (!(event.key in changes)) return;
    event.preventDefault();
    current.setUTCDate(current.getUTCDate() + changes[event.key]);
    const next = dateKey(current);
    onChange(next);
    requestAnimationFrame(() => calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus());
  }

  return (
    <section className="attendance-calendar" aria-label="출석부 달력">
      <div className="calendar-toolbar">
        <div className="calendar-month-nav">
          <button type="button" aria-label="이전 달" onClick={() => moveMonth(-1)}>‹</button>
          <h2 aria-live="polite">{year}년 {monthIndex + 1}월</h2>
          <button type="button" aria-label="다음 달" onClick={() => moveMonth(1)}>›</button>
        </div>
        <button type="button" className="calendar-today" onClick={() => onChange(today)}>오늘</button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {weekdays.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-days" ref={calendar} role="group" aria-label={`${year}년 ${monthIndex + 1}월 날짜 선택`}>
        {Array.from({ length: cells }, (_, index) => {
          const day = index - offset + 1;
          if (day < 1 || day > days) return <span key={index} aria-hidden="true" />;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const count = counts.get(date) || 0;
          return (
            <button
              key={index}
              type="button"
              className={`calendar-day${date === today ? " is-today" : ""}`}
              data-date={date}
              aria-label={`${year}년 ${monthIndex + 1}월 ${day}일 ${weekdays[index % 7]}요일, 기록 ${count}건`}
              aria-pressed={date === value}
              aria-current={date === today ? "date" : undefined}
              tabIndex={date === tabDate ? 0 : -1}
              onClick={() => onChange(date)}
              onKeyDown={(event) => moveFocus(event, date)}
            >
              <span>{day}</span>
              <small>{count ? `${count > 99 ? "99+" : count}건` : "·"}</small>
            </button>
          );
        })}
      </div>
      <p className="calendar-hint">날짜를 선택하면 아래에 근무기록이 표시됩니다.</p>
    </section>
  );
}

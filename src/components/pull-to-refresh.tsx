"use client";
import { useEffect, useRef, useState } from "react";

const threshold = 64;
export function PullToRefresh({ enabled, blocked, onRefresh }: {
  enabled: boolean; blocked: boolean; onRefresh: () => Promise<unknown>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ blocked, onRefresh });
  const active = useRef(false);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { latest.current = { blocked, onRefresh }; }, [blocked, onRefresh]);
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let pulled = 0;
    let mounted = true;
    const clear = () => { start = null; pulled = 0; setDistance(0); };
    const begin = (event: TouchEvent) => {
      clear();
      const target = event.target;
      if (latest.current.blocked || active.current || window.scrollY > 0 || event.touches.length !== 1 ||
        !(target instanceof Element) || !root.current?.parentElement?.contains(target) ||
        target.closest('button,a,input,select,textarea,summary,[role="dialog"]')) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      if (latest.current.blocked || event.touches.length !== 1 || window.scrollY > 0) { clear(); return; }
      const dy = event.touches[0].clientY - start.y;
      const dx = Math.abs(event.touches[0].clientX - start.x);
      if (dy < 0 || dx > Math.max(dy, 12)) { clear(); return; }
      if (dy < 8) return;
      if (event.cancelable) event.preventDefault();
      pulled = Math.min(88, dy * 0.5);
      setDistance(pulled);
    };
    const end = () => {
      const refresh = pulled >= threshold && !latest.current.blocked && !active.current;
      clear();
      if (!refresh) return;
      active.current = true; setRefreshing(true);
      void latest.current.onRefresh().finally(() => {
        active.current = false;
        if (mounted) setRefreshing(false);
      });
    };
    document.documentElement.classList.add("pull-refresh-enabled");
    document.addEventListener("touchstart", begin, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", clear);
    return () => {
      mounted = false;
      document.documentElement.classList.remove("pull-refresh-enabled");
      document.removeEventListener("touchstart", begin);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", clear);
    };
  }, [enabled]);
  if (!enabled) return null;
  return <div ref={root} className="pull-refresh" style={{ height: refreshing ? 48 : distance }}>
    {(refreshing || distance > 0) && <span role="status" aria-live="polite">
      <span aria-hidden="true" className={refreshing ? "refresh-spinner" : ""}>{refreshing ? "↻" : distance >= threshold ? "↑" : "↓"}</span>
      {refreshing ? "새로고침 중…" : distance >= threshold ? "놓으면 새로고침" : "아래로 당겨 새로고침"}
    </span>}
  </div>;
}

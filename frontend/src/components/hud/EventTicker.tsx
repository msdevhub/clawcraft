import { useEffect, useRef, useState } from 'react';
import { useWorldStore } from '@/store/world-store';
import type { SSEEvent } from '@/store/types';

const EVENT_ICONS: Record<string, string> = {
  thinking: '💭',
  tool: '🔧',
  error: '❌',
  complete: '✅',
  info: 'ℹ️',
  connection: '🔌',
};

const EVENT_COLORS: Record<string, string> = {
  thinking: 'text-sky-400',
  tool: 'text-amber-400',
  error: 'text-red-400',
  complete: 'text-emerald-400',
  info: 'text-slate-400',
  connection: 'text-cyan-400',
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function EventRow({ event }: { event: SSEEvent }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1 text-xs transition-colors hover:bg-white/5 rounded">
      <span className="mt-0.5 shrink-0 text-[10px]">{EVENT_ICONS[event.type] ?? '📌'}</span>
      <span className={`flex-1 leading-tight ${EVENT_COLORS[event.type] ?? 'text-slate-400'}`}>{event.message}</span>
      <span className="shrink-0 text-[10px] text-slate-600">{formatTime(event.ts)}</span>
    </div>
  );
}

export function EventTicker() {
  const recentEvents = useWorldStore((s) => s.recentEvents);
  const [collapsed, setCollapsed] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const events = [...recentEvents].reverse();

  const prevCountRef = useRef(recentEvents.length);

  // Auto-expand when first event arrives
  useEffect(() => {
    if (recentEvents.length > 0 && prevCountRef.current === 0) {
      setCollapsed(false);
    }
    prevCountRef.current = recentEvents.length;
  }, [recentEvents.length]);

  useEffect(() => {
    if (collapsed || recentEvents.length === 0) {
      return;
    }

    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [collapsed, recentEvents.length]);

  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-950/75 shadow-lg backdrop-blur-md">
      {/* Header - always visible */}
      <button
        onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
        className="flex w-full items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
      >
        <span>📜 事件日志 {recentEvents.length > 0 && <span className="text-slate-600">({recentEvents.length})</span>}</span>
        <span className="text-slate-600">{collapsed ? '▼' : '▲'}</span>
      </button>

      {/* Events list */}
      {!collapsed && (
        <div className="max-h-[200px] overflow-y-auto border-t border-slate-700/30 px-1 py-1 scrollbar-thin">
          {events.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-600">等待事件...</p>
          ) : (
            events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

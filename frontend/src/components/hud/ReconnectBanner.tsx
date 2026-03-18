import { useWorldStore } from '@/store/world-store';

export function ReconnectBanner() {
  const connected = useWorldStore((s) => s.connected);
  const reconnectAttempt = useWorldStore((s) => s.reconnectAttempt);

  if (connected) return null;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-50 -translate-x-1/2 flex items-center gap-2 rounded-xl bg-amber-600/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg backdrop-blur">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      正在重新连接... {reconnectAttempt > 0 && `(第 ${reconnectAttempt} 次尝试)`}
    </div>
  );
}

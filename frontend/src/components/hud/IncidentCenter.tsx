import { useWorldStore } from '@/store/world-store';
import type { Incident } from '@/store/types';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  error: 'bg-red-500/80 text-white',
  warning: 'bg-amber-500/80 text-black',
  info: 'bg-blue-500/60 text-white',
};

const SEVERITY_ICONS: Record<string, string> = {
  critical: '🔴',
  error: '🟠',
  warning: '🟡',
  info: '🔵',
};

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

async function incidentAction(id: string, action: 'ack' | 'resolve' | 'mute') {
  try {
    await fetch('/clawcraft/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: `incident.${action}`, params: { id } }),
    });
  } catch (err) {
    console.error(`Incident ${action} failed:`, err);
  }
}

function IncidentRow({ incident }: { incident: Incident }) {
  const isActive = incident.status === 'open' || incident.status === 'acked';

  return (
    <div className={`flex items-start gap-2 rounded px-2 py-1.5 text-xs ${isActive ? SEVERITY_COLORS[incident.severity] || 'bg-gray-700' : 'bg-gray-800/50 text-gray-400 opacity-60'}`}>
      <span className="mt-0.5 shrink-0">{SEVERITY_ICONS[incident.severity] || '⚪'}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate font-medium">{incident.title}</span>
          {incident.count > 1 && <span className="shrink-0 rounded bg-black/20 px-1 text-[10px]">×{incident.count}</span>}
        </div>
        <div className="mt-0.5 truncate text-[10px] opacity-80">{incident.detail}</div>
        <div className="mt-1 flex items-center gap-1">
          <span className="text-[10px] opacity-60">{timeAgo(incident.lastSeen)}</span>
          {isActive && (
            <>
              <button onClick={() => incidentAction(incident.id, 'ack')} className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] hover:bg-black/40" title="确认">✓</button>
              <button onClick={() => incidentAction(incident.id, 'resolve')} className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] hover:bg-black/40" title="解决">✗</button>
              <button onClick={() => incidentAction(incident.id, 'mute')} className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] hover:bg-black/40" title="静音">🔇</button>
            </>
          )}
          {incident.suggestedActions.length > 0 && (
            <span className="ml-auto text-[10px] opacity-60" title={incident.suggestedActions.map(a => a.label).join(', ')}>
              💡{incident.suggestedActions.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function IncidentCenter() {
  const incidents = useWorldStore((s) => s.incidents);
  const activeIncidents = incidents.filter(i => i.status === 'open' || i.status === 'acked');

  if (activeIncidents.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-red-500/30 bg-gray-900/90 p-2 backdrop-blur-sm">
      <div className="flex items-center gap-1 text-xs font-bold text-red-400">
        <span>⚠️</span>
        <span>事件中心</span>
        <span className="ml-auto rounded bg-red-500/30 px-1.5 text-[10px]">{activeIncidents.length}</span>
      </div>
      <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto">
        {activeIncidents
          .sort((a, b) => {
            const sevOrder = { critical: 0, error: 1, warning: 2, info: 3 };
            return (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4) || b.lastSeen - a.lastSeen;
          })
          .map(inc => <IncidentRow key={inc.id} incident={inc} />)}
      </div>
    </div>
  );
}

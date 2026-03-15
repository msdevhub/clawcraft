import { useMemo, useState } from 'react';
import { useWorldStore } from '@/store/world-store';
import type { EntityType } from '@/store/types';

interface RadarEntry {
  id: string;
  type: EntityType;
  label: string;
  meta: string;
}

const TYPE_ICONS: Record<EntityType, string> = {
  gateway: '🏰',
  agent: '🏛️',
  session: '⚔️',
  building: '🏗️',
};

export function EntityRadar() {
  const agents = useWorldStore((s) => s.agents);
  const sessions = useWorldStore((s) => s.sessions);
  const buildings = useWorldStore((s) => s.buildings);
  const gatewayStatus = useWorldStore((s) => s.gatewayStatus);
  const panTo = useWorldStore((s) => s.panTo);
  const [open, setOpen] = useState(false);

  const entities = useMemo<RadarEntry[]>(() => {
    const entries: RadarEntry[] = [
      { id: 'gateway', type: 'gateway', label: 'Gateway', meta: gatewayStatus },
    ];

    Object.values(agents).forEach((agent) => {
      entries.push({
        id: agent.agentId,
        type: 'agent',
        label: agent.name,
        meta: `${agent.status} · ${agent.sessionKeys.length} sessions`,
      });
    });

    Object.values(sessions).forEach((session) => {
      entries.push({
        id: session.sessionKey,
        type: 'session',
        label: session.sessionKey.slice(0, 12),
        meta: `${session.agentId} · ${session.status}`,
      });
    });

    buildings.forEach((building) => {
      entries.push({
        id: building.id,
        type: 'building',
        label: building.name,
        meta: `${building.count} items`,
      });
    });

    return entries;
  }, [agents, buildings, gatewayStatus, sessions]);

  const handleSelect = (entry: RadarEntry) => {
    panTo(entry.id, entry.type);
    setOpen(false);
  };

  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20">
      {open && (
        <div className="mb-2 w-72 rounded-xl border border-slate-700/40 bg-slate-950/92 p-2 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Entity Radar</span>
            <span className="text-[10px] text-slate-600">{entities.length}</span>
          </div>
          <div className="mt-1 max-h-72 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {entities.map((entry) => (
              <button
                key={`${entry.type}:${entry.id}`}
                onClick={() => handleSelect(entry)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5"
              >
                <span className="min-w-0 text-xs text-slate-200">
                  <span className="mr-2">{TYPE_ICONS[entry.type]}</span>
                  <span className="truncate align-middle">{entry.label}</span>
                </span>
                <span className="ml-3 shrink-0 text-[10px] text-slate-500">{entry.meta}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700/50 bg-slate-900/85 text-lg text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800/85"
        title="Entity Radar"
      >
        🧭
      </button>
    </div>
  );
}

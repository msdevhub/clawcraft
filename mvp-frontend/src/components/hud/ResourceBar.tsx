import { useState } from 'react';
import { useWorldStore } from '@/store/world-store';

export function ResourceBar() {
  const connected = useWorldStore((s) => s.connected);
  const agents = useWorldStore((s) => s.agents);
  const sessions = useWorldStore((s) => s.sessions);
  const channels = useWorldStore((s) => s.channels);
  const gatewayStatus = useWorldStore((s) => s.gatewayStatus);
  const muted = useWorldStore((s) => s.muted);
  const toggleMuted = useWorldStore((s) => s.toggleMuted);

  const [expanded, setExpanded] = useState(false);

  const agentCount = Object.keys(agents).length;
  const sessionCount = Object.values(sessions).filter((s) => s.status !== 'ended').length;
  const activeCount = Object.values(sessions).filter((s) => ['thinking', 'tooling', 'responding'].includes(s.status)).length;
  const channelEntries = Object.values(channels);
  const channelTotal = channelEntries.length;
  const channelOnline = channelEntries.filter((c) => c.status === 'connected').length;

  // Mobile capsule mode (tap to expand)
  return (
    <div className="flex items-center rounded-2xl border border-slate-700/40 bg-gradient-to-r from-slate-950/90 via-slate-900/90 to-slate-950/90 shadow-2xl backdrop-blur-xl">
      {/* Gateway status — always visible */}
      <button
        className="flex items-center gap-1.5 px-3 py-2 border-r border-slate-700/30 sm:cursor-default"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${gatewayStatus === 'running' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)] animate-pulse' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]'}`} />
        <span className="text-sm">🏰</span>
        {/* Mobile: show active count inline */}
        {activeCount > 0 && (
          <span className="font-mono text-[10px] text-amber-400 animate-pulse sm:hidden">⚡{activeCount}</span>
        )}
      </button>
      
      {/* Expandable details — always visible on desktop, toggle on mobile */}
      <div className={`flex items-center overflow-hidden transition-all duration-200 ${expanded ? 'max-w-[400px] opacity-100' : 'max-w-0 opacity-0 sm:max-w-[400px] sm:opacity-100'}`}>
        {/* Agents */}
        <div className="flex items-center gap-1 px-3 py-2 border-r border-slate-700/30 group hover:bg-slate-800/30 transition-colors cursor-default" title="Agents">
          <span className="text-xs opacity-70 group-hover:opacity-100 transition-opacity">🏛️</span>
          <span className="font-mono text-xs font-bold text-emerald-300">{agentCount}</span>
        </div>

        {/* Sessions */}
        <div className="flex items-center gap-1 px-3 py-2 border-r border-slate-700/30 group hover:bg-slate-800/30 transition-colors cursor-default" title="Sessions">
          <span className="text-xs opacity-70 group-hover:opacity-100 transition-opacity">⚔️</span>
          <span className="font-mono text-xs font-bold text-sky-300">{sessionCount}</span>
          {activeCount > 0 && (
            <span className="font-mono text-[10px] text-amber-400 animate-pulse">⚡{activeCount}</span>
          )}
        </div>

        {/* Channels */}
        <div className={`flex items-center gap-1 px-3 py-2 border-r border-slate-700/30 group hover:bg-slate-800/30 transition-colors cursor-default ${channelOnline > 0 ? '' : 'opacity-50'}`} title="Channels">
          <span className="text-xs opacity-70 group-hover:opacity-100 transition-opacity">📡</span>
          <span className={`font-mono text-xs font-bold ${channelOnline > 0 ? 'text-cyan-300' : 'text-slate-500'}`}>{channelOnline}/{channelTotal}</span>
        </div>

        {/* SSE Connection */}
        <div className="flex items-center px-2.5 py-2 border-r border-slate-700/30" title={connected ? 'Connected' : 'Disconnected'}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
        </div>
      </div>

      {/* Mute toggle — always visible */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleMuted(); }}
        className="px-3 py-2 text-xs text-slate-500 transition-all hover:text-slate-200 hover:bg-slate-800/30 rounded-r-2xl"
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}

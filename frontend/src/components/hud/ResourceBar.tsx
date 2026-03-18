import { useEffect, useState } from 'react';
import type { ActivityStats } from '@/store/types';
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
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const agentCount = Object.keys(agents).length;
  const sessionCount = Object.values(sessions).filter((s) => s.status !== 'ended').length;
  const activeCount = Object.values(sessions).filter((s) => ['thinking', 'tooling', 'responding'].includes(s.status)).length;
  const channelEntries = Object.values(channels);
  const channelTotal = channelEntries.length;
  const channelOnline = channelEntries.filter((c) => c.status === 'connected').length;

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const loadStats = async (showSpinner = false) => {
      controller?.abort();
      controller = new AbortController();

      if (showSpinner) {
        setStatsLoading(true);
      }

      try {
        const response = await fetch('/clawcraft/activity?statsOnly=true', { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`统计接口返回 ${response.status}`);
        }

        const payload = await response.json();
        if (!active) {
          return;
        }

        setStats(payload.stats ?? null);
        setStatsError(null);
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setStatsError(error instanceof Error ? error.message : '加载活动统计失败');
      } finally {
        if (active) {
          setStatsLoading(false);
        }
      }
    };

    void loadStats(true);
    const interval = window.setInterval(() => {
      void loadStats(false);
    }, 30_000);

    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, []);

  const statsLabel = statsError
    ? '加载失败，点击重试'
    : statsLoading && !stats
      ? 'Today: ...'
      : `Today: ${stats?.llmCallsToday ?? 0} calls · ${stats?.tokensToday ?? 0} tokens · ${stats?.toolCallsToday ?? 0} tools`;

  // Mobile capsule mode (tap to expand)
  return (
    <div className="flex items-center rounded-2xl border border-slate-700/40 bg-gradient-to-r from-slate-950/90 via-slate-900/90 to-slate-950/90 shadow-2xl backdrop-blur-xl">
      {/* Gateway status — always visible */}
      <button
        className="flex items-center gap-1.5 border-r border-slate-700/30 px-3 py-2 transition-all duration-200 sm:cursor-default"
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
        <div className="group flex cursor-default items-center gap-1 border-r border-slate-700/30 px-3 py-2 transition-all duration-200 hover:bg-slate-800/30" title="Agents">
          <span className="text-xs opacity-70 group-hover:opacity-100 transition-opacity">🏛️</span>
          <span className="font-mono text-xs font-bold text-emerald-300">{agentCount}</span>
        </div>

        {/* Sessions */}
        <div className="group flex cursor-default items-center gap-1 border-r border-slate-700/30 px-3 py-2 transition-all duration-200 hover:bg-slate-800/30" title="Sessions">
          <span className="text-xs opacity-70 group-hover:opacity-100 transition-opacity">⚔️</span>
          <span className="font-mono text-xs font-bold text-sky-300">{sessionCount}</span>
          {activeCount > 0 && (
            <span className="font-mono text-[10px] text-amber-400 animate-pulse">⚡{activeCount}</span>
          )}
        </div>

        <button
          onClick={() => {
            setStatsError(null);
            setStatsLoading(true);
            void fetch('/clawcraft/activity?statsOnly=true')
              .then(async (response) => {
                if (!response.ok) {
                  throw new Error(`统计接口返回 ${response.status}`);
                }
                const payload = await response.json();
                setStats(payload.stats ?? null);
                setStatsError(null);
              })
              .catch((error) => {
                setStatsError(error instanceof Error ? error.message : '加载活动统计失败');
              })
              .finally(() => setStatsLoading(false));
          }}
          className={`flex items-center gap-1 border-r border-slate-700/30 px-3 py-2 text-left transition-all duration-200 hover:bg-slate-800/30 ${
            statsError ? 'text-red-300' : 'text-slate-300'
          }`}
          title={statsError || '今日调用统计'}
        >
          <span className={`text-xs ${statsError ? '' : 'text-amber-300'}`}>🔥</span>
          <span className="whitespace-nowrap text-[11px]">{statsLabel}</span>
        </button>

        {/* Channels */}
        <div className={`group flex cursor-default items-center gap-1 border-r border-slate-700/30 px-3 py-2 transition-all duration-200 hover:bg-slate-800/30 ${channelOnline > 0 ? '' : 'opacity-50'}`} title={`${channelOnline} 个频道在线，共 ${channelTotal} 个`}>
          <span className="text-xs opacity-70 group-hover:opacity-100 transition-opacity">📡</span>
          <span className={`font-mono text-xs font-bold ${channelOnline > 0 ? 'text-cyan-300' : 'text-slate-500'}`}>{channelOnline}</span>
        </div>

        {/* SSE Connection + Channel Health */}
        <div className="flex items-center border-r border-slate-700/30 px-2.5 py-2" title={
          !connected ? '已断开连接'
            : channelTotal > 0 && channelOnline === 0 ? '已连接，但所有频道离线'
            : channelOnline < channelTotal ? `已连接，${channelTotal - channelOnline} 个频道离线`
            : '已连接'
        }>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${
            !connected ? 'bg-red-400 animate-pulse'
              : channelTotal > 0 && channelOnline === 0 ? 'bg-amber-400 animate-pulse'
              : channelOnline < channelTotal ? 'bg-amber-400'
              : 'bg-emerald-400'
          }`} />
        </div>
      </div>

      {/* Mute toggle — always visible */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleMuted(); }}
        className="rounded-r-2xl px-3 py-2 text-xs text-slate-500 transition-all duration-200 hover:bg-slate-800/30 hover:text-slate-200"
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}

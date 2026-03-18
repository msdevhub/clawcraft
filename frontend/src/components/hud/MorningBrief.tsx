import { useEffect, useState } from 'react';
import { useWorldStore } from '@/store/world-store';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(since: number): string {
  const hours = Math.floor((Date.now() - since) / 3600000);
  if (hours < 1) return '不到 1 小时';
  return `${hours} 小时`;
}

export function MorningBrief() {
  const summary = useWorldStore((s) => s.overnightSummary);
  const [dismissed, setDismissed] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Auto-minimize after 5 seconds to avoid blocking the view
  useEffect(() => {
    if (!summary || dismissed || minimized) return;
    const timer = setTimeout(() => setMinimized(true), 5000);
    return () => clearTimeout(timer);
  }, [summary, dismissed, minimized]);

  if (!summary || dismissed) return null;

  // Minimized state: small badge at top
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-xl border border-amber-500/30 bg-gray-900/90 px-4 py-2 text-xs text-amber-300 shadow-lg backdrop-blur-sm transition-all hover:bg-gray-800/95 hover:text-amber-200"
      >
        🌅 晨间简报 {summary.errors.length > 0 && <span className="ml-1 text-red-400">({summary.errors.length} 错误)</span>}
      </button>
    );
  }

  const hasErrors = summary.errors.length > 0;
  const hasCronFailures = summary.cronRuns.failed > 0;

  return (
    <div className="absolute left-1/2 top-20 z-30 w-[360px] -translate-x-1/2 rounded-xl border border-amber-500/30 bg-gray-900/95 p-4 shadow-2xl backdrop-blur-sm transition-all">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-amber-400">🌅 晨间简报</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setMinimized(true)} className="text-xs text-gray-400 hover:text-white" title="最小化">—</button>
          <button onClick={() => setDismissed(true)} className="text-xs text-gray-400 hover:text-white" title="关闭">✕</button>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-gray-500">
        你离开了 {formatDuration(summary.since)}（自 {formatTime(summary.since)}）
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-gray-800 p-2">
          <div className="text-lg font-bold text-green-400">{summary.cronRuns.success}</div>
          <div className="text-[10px] text-gray-400">Cron 成功</div>
        </div>
        <div className="rounded bg-gray-800 p-2">
          <div className={`text-lg font-bold ${hasCronFailures ? 'text-red-400' : 'text-gray-400'}`}>{summary.cronRuns.failed}</div>
          <div className="text-[10px] text-gray-400">Cron 失败</div>
        </div>
        <div className="rounded bg-gray-800 p-2">
          <div className="text-lg font-bold text-blue-400">{summary.tokenUsage.total.toLocaleString()}</div>
          <div className="text-[10px] text-gray-400">Token 消耗</div>
        </div>
      </div>

      {summary.compactions > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          🗜️ {summary.compactions} 次对话压缩
        </div>
      )}

      {hasErrors && (
        <div className="mt-2">
          <div className="text-xs font-medium text-red-400">⚠️ 错误记录:</div>
          <div className="mt-1 max-h-[80px] overflow-y-auto">
            {summary.errors.map((err, i) => (
              <div key={i} className="flex items-center gap-1 text-[10px] text-gray-300">
                <span className="text-red-400">●</span>
                <span className="truncate">{err.source}: {err.type}</span>
                {err.count > 1 && <span className="text-gray-500">×{err.count}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.channelEvents.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-medium text-blue-400">📡 频道事件:</div>
          <div className="mt-1 max-h-[60px] overflow-y-auto">
            {summary.channelEvents.slice(0, 5).map((ev, i) => (
              <div key={i} className="text-[10px] text-gray-300">
                {formatTime(ev.at)} — {ev.channel}: {ev.event}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(summary.tokenUsage.byAgent).length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-medium text-purple-400">🤖 Agent Token 明细:</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(summary.tokenUsage.byAgent).map(([agent, tokens]) => (
              <span key={agent} className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
                {agent}: {(tokens as number).toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

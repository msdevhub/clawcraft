import { useState, useEffect, useCallback } from 'react';
import { useWorldStore } from '@/store/world-store';

interface PluginPanelProps {
  onClose: () => void;
}

export function PluginPanel({ onClose }: PluginPanelProps) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const addEvent = useWorldStore((s) => s.addEvent);

  const loadConfig = useCallback(() => {
    fetch('/clawcraft/config')
      .then(r => r.json())
      .then(data => { if (data.ok) setConfig(data.config); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const entries = config?.plugins?.entries || {};

  const handleToggle = useCallback(async (pluginId: string, currentEnabled: boolean) => {
    setToggling(pluginId);
    try {
      const res = await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'plugin.toggle', params: { pluginId, enabled: !currentEnabled } }),
      });
      const data = await res.json();
      if (data.ok) {
        addEvent({ id: `plugin-${Date.now()}`, type: 'info', message: `🔌 ${pluginId} ${!currentEnabled ? '已启用' : '已停用'}`, ts: Date.now() });
        // Floating text on building
        (window as any).__floatText?.('plugins', !currentEnabled ? `+ ${pluginId} 已启用` : `- ${pluginId} 已停用`, !currentEnabled ? 0x22c55e : 0xef4444);
        loadConfig();
      } else {
        addEvent({ id: `err-${Date.now()}`, type: 'error', message: `操作失败: ${data.error}`, ts: Date.now() });
      }
    } catch (err: any) {
      addEvent({ id: `err-${Date.now()}`, type: 'error', message: `操作失败: ${err.message}`, ts: Date.now() });
    } finally {
      setToggling(null);
    }
  }, [addEvent, loadConfig]);

  return (
    <div className="w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔌</span>
          <h2 className="text-base font-bold text-slate-100">插件工厂</h2>
          <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-400">
            {Object.keys(entries).length} 个插件
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">✕</button>
      </div>
      <div className="max-h-[55vh] overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {loading ? (
          <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
        ) : Object.keys(entries).length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-2xl mb-2">🔌</p>
            <p className="text-sm text-slate-500">插件工厂尚未运转…</p>
            <p className="text-xs text-slate-600 mt-1">在配置文件中添加插件，工厂便会苏醒</p>
          </div>
        ) : (
          Object.entries(entries).map(([id, p]: [string, any]) => (
            <div key={id} className="flex items-center justify-between rounded-xl border border-slate-700/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚙️</span>
                <p className="text-sm font-medium text-slate-200">{id}</p>
              </div>
              <button
                onClick={() => handleToggle(id, p.enabled !== false)}
                disabled={toggling === id}
                className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
                  p.enabled !== false
                    ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                    : 'bg-slate-700/50 text-slate-500 hover:bg-slate-700/70'
                } disabled:opacity-50`}
              >
                {toggling === id ? '⏳' : p.enabled !== false ? '✅ 启用' : '⏸️ 停用'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

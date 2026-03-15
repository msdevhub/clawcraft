import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { useWorldStore } from '@/store/world-store';

interface BindingsPanelProps {
  onClose: () => void;
}

interface BindingRow {
  id: string;
  channelType: string;
  agentId: string;
  extra: Record<string, unknown>;
}

const CHANNEL_LABELS: Record<string, string> = {
  mattermost: 'Mattermost',
  telegram: 'Telegram',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  slack: 'Slack',
};

function normalizeBindings(bindings: any): BindingRow[] {
  if (!bindings || typeof bindings !== 'object') return [];

  return Object.entries(bindings).map(([channelType, binding], index) => {
    const record = binding && typeof binding === 'object' ? { ...(binding as Record<string, unknown>) } : {};
    const agentId = typeof record.agentId === 'string' ? record.agentId : '';
    delete record.agentId;

    return {
      id: `${channelType}-${index}`,
      channelType,
      agentId,
      extra: record,
    };
  });
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full rounded-2xl border border-slate-700/80 bg-slate-950/65 px-4 text-sm text-slate-100 outline-none ring-0 focus:border-sky-400/50"
    >
      {children}
    </select>
  );
}

export function BindingsPanel({ onClose }: BindingsPanelProps) {
  const [config, setConfig] = useState<any>(null);
  const [rows, setRows] = useState<BindingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);

  const agents = useWorldStore((s) => s.agents);
  const addEvent = useWorldStore((s) => s.addEvent);

  const loadConfig = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);

    try {
      const response = await fetch('/clawcraft/config');
      const data = await response.json();
      if (data.ok) {
        setConfig(data.config);
        setRows(normalizeBindings(data.config?.bindings));
      } else {
        setActionResult({ ok: false, message: data.error || '读取 bindings 失败' });
      }
    } catch (err: any) {
      setActionResult({ ok: false, message: err.message || '读取 bindings 失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig(true);
  }, [loadConfig]);

  const channelOptions = useMemo(() => Object.keys(config?.channels || {}), [config]);
  const agentOptions = useMemo(() => {
    const ids = new Set<string>(['main']);

    for (const entry of config?.agents?.list || []) {
      if (typeof entry?.id === 'string' && entry.id) ids.add(entry.id);
    }

    for (const agentId of Object.keys(agents)) ids.add(agentId);
    for (const row of rows) if (row.agentId) ids.add(row.agentId);

    return Array.from(ids);
  }, [agents, config, rows]);

  const updateRow = useCallback((rowId: string, patch: Partial<BindingRow>) => {
    setRows((prev) => prev.map((row) => row.id === rowId ? { ...row, ...patch } : row));
  }, []);

  const handleAddRow = useCallback(() => {
    const usedChannels = new Set(rows.map((row) => row.channelType));
    const nextChannel = channelOptions.find((channel) => !usedChannels.has(channel)) || channelOptions[0] || '';
    const nextAgent = agentOptions[0] || 'main';

    setRows((prev) => [
      ...prev,
      {
        id: `binding-${Date.now()}`,
        channelType: nextChannel,
        agentId: nextAgent,
        extra: {},
      },
    ]);
  }, [agentOptions, channelOptions, rows]);

  const handleSave = useCallback(async () => {
    const nextBindings: Record<string, Record<string, unknown>> = {};

    for (const row of rows) {
      const channelType = row.channelType.trim();
      const agentId = row.agentId.trim();

      if (!channelType) {
        setActionResult({ ok: false, message: '存在未选择频道的绑定' });
        return;
      }

      if (!agentId) {
        setActionResult({ ok: false, message: `绑定 ${channelType} 缺少 agentId` });
        return;
      }

      if (nextBindings[channelType]) {
        setActionResult({ ok: false, message: `频道 ${channelType} 存在重复绑定` });
        return;
      }

      nextBindings[channelType] = {
        ...row.extra,
        agentId,
      };
    }

    setSaving(true);
    setActionResult(null);

    try {
      const response = await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'config.update',
          params: {
            path: 'bindings',
            value: nextBindings,
          },
        }),
      });
      const data = await response.json();

      if (!data.ok) {
        setActionResult({ ok: false, message: data.error || '保存失败' });
        return;
      }

      const restartSuffix = data.data?.needsRestart ? '，需重启 Gateway 生效' : '';
      setActionResult({ ok: true, message: `${data.message || 'Bindings 已更新'}${restartSuffix}` });
      addEvent({
        id: `bindings-update-${Date.now()}`,
        type: 'info',
        message: `📎 路由绑定已更新${restartSuffix}`,
        ts: Date.now(),
      });
      await loadConfig();
    } catch (err: any) {
      setActionResult({ ok: false, message: err.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  }, [addEvent, loadConfig, rows]);

  return (
    <div className="w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">📎</span>
          <h2 className="text-base font-bold text-slate-100">路由绑定</h2>
          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">Bindings</span>
        </div>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-5 scrollbar-thin">
        {loading ? (
          <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 rounded-xl border border-slate-700/30 bg-slate-900/30 p-3 text-xs">
              <InfoRow label="频道数" value={`${channelOptions.length}`} />
              <InfoRow label="Agent 数" value={`${agentOptions.length}`} />
              <InfoRow label="绑定数" value={`${rows.length}`} />
            </div>

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700/50 px-4 py-6 text-center text-sm text-slate-600">
                暂无路由绑定，点击下方添加第一条。
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((row) => (
                  <div key={row.id} className="space-y-3 rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-100">
                          {CHANNEL_LABELS[row.channelType] || row.channelType || '未选择频道'} → {row.agentId || '未选择 Agent'}
                        </p>
                        <p className="text-[11px] text-slate-500">编辑 channel → agent 路由</p>
                      </div>
                      <button
                        onClick={() => setRows((prev) => prev.filter((entry) => entry.id !== row.id))}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300 transition-colors hover:bg-red-500/20"
                      >
                        🗑️ 删除
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="block text-[11px] text-slate-500">频道</span>
                        {channelOptions.length > 0 ? (
                          <Select value={row.channelType} onChange={(value) => updateRow(row.id, { channelType: value })}>
                            <option value="">选择频道</option>
                            {channelOptions.map((channel) => (
                              <option key={channel} value={channel}>
                                {CHANNEL_LABELS[channel] || channel}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Input value={row.channelType} onChange={(event) => updateRow(row.id, { channelType: event.target.value })} placeholder="mattermost" />
                        )}
                      </label>

                      <label className="space-y-1">
                        <span className="block text-[11px] text-slate-500">Agent</span>
                        <Select value={row.agentId} onChange={(value) => updateRow(row.id, { agentId: value })}>
                          <option value="">选择 Agent</option>
                          {agentOptions.map((agentId) => (
                            <option key={agentId} value={agentId}>
                              {agentId}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleAddRow}
              className="w-full rounded-xl border-2 border-dashed border-slate-700/50 py-4 text-sm text-slate-500 transition-colors hover:border-sky-500/50 hover:text-sky-400"
            >
              ➕ 添加绑定
            </button>

            {actionResult && (
              <div className={`rounded-lg px-3 py-2 text-xs ${actionResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                {actionResult.ok ? '✅' : '❌'} {actionResult.message}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-700/40 px-5 py-3">
        <span className="text-[10px] text-slate-600">修改 bindings 后需要重启 Gateway 生效</span>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-200"
          >
            关闭
          </button>
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? '⏳ 保存中...' : '💾 保存绑定'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-[11px] text-slate-300">{value}</span>
    </div>
  );
}

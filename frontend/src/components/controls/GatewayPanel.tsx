import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CanvasForm, DiscoveryForm, GatewayAdvancedForm, LoggingForm } from '@/components/controls/settings-forms';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/auth-fetch';
import { useWorldStore } from '@/store/world-store';

interface GatewayPanelProps {
  onClose: () => void;
  onOpenBindings: () => void;
  onOpenSettings: () => void;
}

interface DefaultModelForm {
  primary: string;
  fallbacks: string[];
}

function readDefaultModelConfig(input: any): DefaultModelForm {
  if (typeof input === 'string') {
    return { primary: input, fallbacks: [] };
  }

  return {
    primary: typeof input?.primary === 'string' ? input.primary : '',
    fallbacks: Array.isArray(input?.fallbacks) ? input.fallbacks.filter((value: unknown): value is string => typeof value === 'string') : [],
  };
}

export function GatewayPanel({ onClose, onOpenBindings, onOpenSettings }: GatewayPanelProps) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<DefaultModelForm>({ primary: '', fallbacks: [] });
  const [newFallback, setNewFallback] = useState('');
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);

  const agents = useWorldStore((s) => s.agents);
  const sessions = useWorldStore((s) => s.sessions);
  const channels = useWorldStore((s) => s.channels);
  const gatewayStatus = useWorldStore((s) => s.gatewayStatus);
  const version = useWorldStore((s) => s.version);
  const addEvent = useWorldStore((s) => s.addEvent);

  const loadConfig = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);

    try {
      const response = await authFetch('/clawcraft/config');
      const data = await response.json();
      if (data.ok) {
        setConfig(data.config);
        setModelForm(readDefaultModelConfig(data.config?.agents?.defaults?.model));
      } else {
        setActionResult({ ok: false, message: data.error || '读取配置失败' });
      }
    } catch (err: any) {
      setActionResult({ ok: false, message: err.message || '读取配置失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig(true);
  }, [loadConfig]);

  const agentCount = Object.keys(agents).length;
  const sessionCount = Object.values(sessions).filter((session) => session.status !== 'ended').length;
  const channelCount = Object.keys(channels).length;
  const connectedChannels = Object.values(channels).filter((channel: any) => channel.status === 'connected').length;
  const bindingCount = Object.keys(config?.bindings || {}).length;

  const executeAction = useCallback(async (
    type: string,
    params: Record<string, unknown>,
    key: string,
    successMessage: string,
  ) => {
    setSavingKey(key);
    setActionResult(null);

    try {
      const response = await authFetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params }),
      });
      const data = await response.json();

      if (!data.ok) {
        setActionResult({ ok: false, message: data.error || '操作失败' });
        return data;
      }

      const restartSuffix = data.data?.needsRestart ? '，需重启 Gateway 生效' : '';
      setActionResult({ ok: true, message: `${data.message || successMessage}${restartSuffix}` });
      addEvent({
        id: `${type}-${Date.now()}`,
        type: 'info',
        message: `${successMessage}${restartSuffix}`,
        ts: Date.now(),
      });
      await loadConfig();
      return data;
    } catch (err: any) {
      setActionResult({ ok: false, message: err.message || '操作失败' });
      return { ok: false, error: err.message || '操作失败' };
    } finally {
      setSavingKey(null);
    }
  }, [addEvent, loadConfig]);

  const handleRestart = useCallback(async () => {
    if (!confirm('⚠️ 确定要重启 Gateway 吗？\n所有连接将临时断开。')) return;

    await executeAction(
      'gateway.restart',
      {},
      'gateway:restart',
      '🔄 Gateway 重启中...',
    );
  }, [executeAction]);

  const handleSaveDefaultModel = useCallback(async () => {
    await executeAction(
      'config.update',
      {
        path: 'agents.defaults.model',
        value: {
          primary: modelForm.primary.trim(),
          fallbacks: modelForm.fallbacks.map((value) => value.trim()).filter(Boolean),
        },
      },
      'config:update:agents.defaults.model',
      '🧠 默认模型配置已更新',
    );
  }, [executeAction, modelForm]);

  return (
    <div className="w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏰</span>
          <h2 className="text-base font-bold text-slate-100">Gateway</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            gatewayStatus === 'running' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {gatewayStatus}
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4 scrollbar-thin">
        {loading ? (
          <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <StatCard icon="🏛️" label="领主" value={`${agentCount}`} />
              <StatCard icon="⚔️" label="探险者" value={`${sessionCount}`} />
              <StatCard icon="📡" label="频道" value={`${connectedChannels}/${channelCount}`} />
              <StatCard icon="📎" label="绑定" value={`${bindingCount}`} />
            </div>

            <div className="rounded-xl border border-slate-700/30 p-3 space-y-1.5 text-xs">
              <InfoRow label="版本" value={version || config?.version || 'unknown'} />
              <InfoRow label="端口" value={`${config?.gateway?.port || 18789}`} />
              <InfoRow label="Primary Model" value={modelForm.primary || '未设置'} />
            </div>

            <div className="space-y-3 rounded-xl border border-slate-700/30 bg-slate-900/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-100">默认模型</p>
                  <p className="text-[11px] text-slate-500">编辑 `agents.defaults.model.primary` 与 `fallbacks[]`</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    onClick={onOpenBindings}
                    className="rounded-lg border border-slate-700/60 bg-slate-950/70 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-sky-500/40 hover:text-sky-300"
                  >
                    📎 路由绑定
                  </button>
                  <button
                    onClick={onOpenSettings}
                    className="rounded-lg border border-slate-700/60 bg-slate-950/70 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                  >
                    🗺️ 配置索引
                  </button>
                </div>
              </div>

              <Field label="Primary">
                <Input
                  value={modelForm.primary}
                  onChange={(event) => setModelForm((prev) => ({ ...prev, primary: event.target.value }))}
                  placeholder="azure-foundry/gpt-5.2"
                />
              </Field>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Fallbacks</span>
                  <span className="text-[10px] text-slate-600">{modelForm.fallbacks.length} 个</span>
                </div>

                {modelForm.fallbacks.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-700/50 px-3 py-2 text-xs text-slate-600">暂无 fallback 模型</p>
                ) : (
                  <div className="space-y-2">
                    {modelForm.fallbacks.map((fallback, index) => (
                      <div key={`${fallback}-${index}`} className="flex gap-2">
                        <Input
                          value={fallback}
                          onChange={(event) => {
                            const value = event.target.value;
                            setModelForm((prev) => ({
                              ...prev,
                              fallbacks: prev.fallbacks.map((entry, entryIndex) => entryIndex === index ? value : entry),
                            }));
                          }}
                          placeholder="azure-foundry/gpt-4o"
                        />
                        <button
                          onClick={() => {
                            setModelForm((prev) => ({
                              ...prev,
                              fallbacks: prev.fallbacks.filter((_, entryIndex) => entryIndex !== index),
                            }));
                          }}
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/20"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    value={newFallback}
                    onChange={(event) => setNewFallback(event.target.value)}
                    placeholder="添加 fallback 模型"
                  />
                  <button
                    onClick={() => {
                      const value = newFallback.trim();
                      if (!value) return;
                      setModelForm((prev) => ({ ...prev, fallbacks: [...prev.fallbacks, value] }));
                      setNewFallback('');
                    }}
                    className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300 transition-colors hover:bg-sky-500/20"
                  >
                    添加
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => {
                    void handleSaveDefaultModel();
                  }}
                  disabled={savingKey === 'config:update:agents.defaults.model'}
                  className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                >
                  {savingKey === 'config:update:agents.defaults.model' ? '⏳ 保存中...' : '💾 保存默认模型'}
                </button>
                <button
                  onClick={() => setModelForm(readDefaultModelConfig(config?.agents?.defaults?.model))}
                  className="rounded-lg border border-slate-700/60 px-3 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
                >
                  取消
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-700/30 bg-slate-900/30 p-3">
              <div>
                <p className="text-sm font-medium text-slate-100">高级设施</p>
                <p className="text-[11px] text-slate-500">日志、发现、Canvas 与 Gateway 高级配置已内嵌到本面板。</p>
              </div>

              <CollapsibleSection icon="📊" title="日志" subtitle="logging">
                <LoggingForm config={config} onConfigRefresh={loadConfig} />
              </CollapsibleSection>

              <CollapsibleSection icon="🔍" title="发现" subtitle="discovery">
                <DiscoveryForm config={config} onConfigRefresh={loadConfig} />
              </CollapsibleSection>

              <CollapsibleSection icon="🖼️" title="Canvas" subtitle="canvasHost">
                <CanvasForm config={config} onConfigRefresh={loadConfig} />
              </CollapsibleSection>

              <CollapsibleSection icon="🔒" title="Gateway 高级" subtitle="gateway">
                <GatewayAdvancedForm config={config} onConfigRefresh={loadConfig} />
              </CollapsibleSection>
            </div>

            <button
              onClick={() => {
                void handleRestart();
              }}
              disabled={savingKey === 'gateway:restart'}
              className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 py-2.5 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
            >
              {savingKey === 'gateway:restart' ? '⏳ 重启中...' : '🔄 重启 Gateway'}
            </button>

            {actionResult && (
              <div className={`rounded-lg px-3 py-2 text-xs ${actionResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                {actionResult.ok ? '✅' : '❌'} {actionResult.message}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 px-3 py-2.5 text-center">
      <span className="text-lg">{icon}</span>
      <p className="mt-0.5 text-sm font-bold text-slate-100">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="break-all text-right font-mono text-[11px] text-slate-300">{value}</span>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { HooksForm, MessagesForm, TtsForm } from '@/components/controls/settings-forms';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { HoldButton } from '@/components/ui/HoldButton';
import { Input } from '@/components/ui/input';
import { useWorldStore } from '@/store/world-store';

interface ChannelConfig {
  enabled?: boolean;
  baseUrl?: string;
  botToken?: string;
  dmPolicy?: string;
  groupPolicy?: string;
  chatmode?: string;
  phoneNumber?: string;
  apiKey?: string;
  appToken?: string;
  allowFrom?: string[];
  [key: string]: any;
}

interface ChannelDefinition {
  id: string;
  label: string;
  icon: string;
  fields: string[];
}

interface TestResult {
  ok: boolean;
  message: string;
}

const CHANNEL_TYPES: ChannelDefinition[] = [
  { id: 'mattermost', label: 'Mattermost', icon: '🟦', fields: ['baseUrl', 'botToken', 'dmPolicy', 'groupPolicy', 'chatmode'] },
  { id: 'telegram', label: 'Telegram', icon: '🔵', fields: ['botToken', 'dmPolicy', 'groupPolicy'] },
  { id: 'discord', label: 'Discord', icon: '🟣', fields: ['botToken', 'dmPolicy', 'groupPolicy'] },
  { id: 'whatsapp', label: 'WhatsApp', icon: '🟢', fields: ['phoneNumber', 'apiKey'] },
  { id: 'signal', label: 'Signal', icon: '💬', fields: ['phoneNumber'] },
  { id: 'slack', label: 'Slack', icon: '🟧', fields: ['botToken', 'appToken'] },
];

const FIELD_LABELS: Record<string, string> = {
  baseUrl: '服务器地址',
  botToken: 'Bot Token',
  dmPolicy: 'DM 策略',
  groupPolicy: '群组策略',
  chatmode: '对话模式',
  phoneNumber: '电话号码',
  apiKey: 'API Key',
  appToken: 'App Token',
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
  baseUrl: 'https://mm.example.com',
  botToken: 'Bot Token',
  dmPolicy: 'open / managed',
  groupPolicy: 'open / managed',
  chatmode: 'oncall / always',
  phoneNumber: '+1234567890',
  apiKey: 'API Key',
  appToken: 'App Token',
};

interface ChannelManagerProps {
  onClose: () => void;
  inline?: boolean;
}

function getChannelDefinition(channelType: string | null | undefined) {
  return CHANNEL_TYPES.find((type) => type.id === channelType);
}

function buildChannelForm(channelType: string, config?: ChannelConfig): Record<string, string> {
  const fields = getChannelDefinition(channelType)?.fields || [];
  const form: Record<string, string> = {};

  for (const field of fields) {
    form[field] = typeof config?.[field] === 'string' ? config[field] : '';
  }

  return form;
}

function finalizeChannelConfig(channelType: string, config: ChannelConfig): ChannelConfig {
  const next = { ...config };

  if (next.dmPolicy === 'open' || !next.dmPolicy) {
    next.allowFrom = ['*'];
    if (!next.dmPolicy) next.dmPolicy = 'open';
  }

  if (!next.groupPolicy) next.groupPolicy = 'open';
  if (!next.chatmode && channelType === 'mattermost') next.chatmode = 'oncall';

  return next;
}

function isSecretField(field: string) {
  return field.includes('Token') || field.includes('Key');
}

function formatChannelValue(value?: string) {
  if (!value) return '未设置';
  return value;
}

export function ChannelManager({ onClose, inline }: ChannelManagerProps) {
  const [config, setConfig] = useState<any>(null);
  const [channels, setChannels] = useState<Record<string, ChannelConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editForms, setEditForms] = useState<Record<string, Record<string, string>>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);

  const addEvent = useWorldStore((s) => s.addEvent);
  const clearTimersRef = useRef<Record<string, number>>({});

  const loadConfig = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setError(null);

    try {
      const res = await fetch('/clawcraft/config');
      const data = await res.json();
      if (data.ok) {
        setConfig(data.config);
        setChannels(data.config?.channels || {});
      } else {
        setError(data.error || '加载失败');
      }
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig(true);
  }, [loadConfig]);

  useEffect(() => () => {
    for (const timer of Object.values(clearTimersRef.current)) window.clearTimeout(timer);
  }, []);

  const clearTestResultLater = useCallback((channelType: string) => {
    if (clearTimersRef.current[channelType]) {
      window.clearTimeout(clearTimersRef.current[channelType]);
    }

    clearTimersRef.current[channelType] = window.setTimeout(() => {
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[channelType];
        return next;
      });
      delete clearTimersRef.current[channelType];
    }, 3000);
  }, []);

  const executeAction = useCallback(async (
    type: string,
    params: Record<string, unknown>,
    key: string,
    successMessage: string,
  ) => {
    setSavingKey(key);
    setActionResult(null);

    try {
      const res = await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params }),
      });
      const data = await res.json();

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
    } catch (e: any) {
      setActionResult({ ok: false, message: e.message || '操作失败' });
      return { ok: false, error: e.message || '操作失败' };
    } finally {
      setSavingKey(null);
    }
  }, [addEvent, loadConfig]);

  const handleAddChannel = useCallback(async () => {
    if (!selectedType) return;

    const nextConfig: ChannelConfig = finalizeChannelConfig(selectedType, {
      enabled: true,
      ...formData,
    });

    const result = await executeAction(
      'channel.add',
      { channelType: selectedType, config: nextConfig },
      `channel:add:${selectedType}`,
      `🏗️ 已建造 ${selectedType} 港口`,
    );

    if (result.ok) {
      setShowAddPanel(false);
      setSelectedType(null);
      setFormData({});
    }
  }, [executeAction, formData, selectedType]);

  const openEditForm = useCallback((channelType: string) => {
    setEditingChannel((current) => (current === channelType ? null : channelType));
    setEditForms((prev) => ({
      ...prev,
      [channelType]: prev[channelType] || buildChannelForm(channelType, channels[channelType]),
    }));
  }, [channels]);

  const handleSaveEdit = useCallback(async (channelType: string) => {
    const currentConfig = channels[channelType];
    if (!currentConfig) return;

    const nextConfig = finalizeChannelConfig(channelType, {
      ...currentConfig,
      ...editForms[channelType],
    });

    const result = await executeAction(
      'channel.update',
      { channelType, config: nextConfig },
      `channel:update:${channelType}`,
      `✏️ 已更新 ${channelType} 港口`,
    );

    if (result.ok) {
      setEditingChannel(null);
    }
  }, [channels, editForms, executeAction]);

  const handleRemoveChannel = useCallback(async (channelType: string) => {
    if (!confirm(`确定要拆除 ${channelType} 港口吗？\n此操作需要重启 Gateway 生效。`)) return;

    await executeAction(
      'channel.remove',
      { channelType },
      `channel:remove:${channelType}`,
      `🗑️ 已拆除 ${channelType} 港口`,
    );
  }, [executeAction]);

  const handleChannelTest = useCallback(async (channelType: string) => {
    setTestingChannel(channelType);
    setTestResults((prev) => ({
      ...prev,
      [channelType]: { ok: true, message: '⏳ 连接测试中...' },
    }));

    try {
      const res = await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'channel.test', params: { channelType } }),
      });
      const data = await res.json();
      const latency = typeof data.data?.latencyMs === 'number' ? `${data.data.latencyMs}ms` : '无延迟数据';
      const detail = data.ok ? data.message || '连接成功' : data.error || '连接失败';
      const message = `${data.ok ? '✅' : '❌'} ${detail} · ${latency}`;

      setTestResults((prev) => ({ ...prev, [channelType]: { ok: Boolean(data.ok), message } }));
      clearTestResultLater(channelType);

      if (data.ok) {
        addEvent({
          id: `channel-test-${channelType}-${Date.now()}`,
          type: 'info',
          message: `🔌 ${channelType} 连接测试通过`,
          ts: Date.now(),
        });
      }
    } catch (e: any) {
      setTestResults((prev) => ({
        ...prev,
        [channelType]: { ok: false, message: `❌ ${e.message || '连接失败'}` },
      }));
      clearTestResultLater(channelType);
    } finally {
      setTestingChannel(null);
    }
  }, [addEvent, clearTestResultLater]);

  const handleRestartGateway = useCallback(async () => {
    await executeAction(
      'gateway.restart',
      {},
      'gateway:restart',
      '🔄 Gateway 重启中...',
    );
    (window as any).__floatText?.('gateway', '🔄 Gateway 重启中...', 0xfbbf24);
  }, [executeAction]);

  return (
    <div
      className={inline ? '' : 'fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm'}
      onClick={inline ? undefined : onClose}
    >
      <div
        className={`rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md ${inline ? 'w-full' : 'mx-4 w-full max-w-2xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-xl">📡</span>
            <h2 className="text-base font-bold text-slate-100">频道港口</h2>
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">Channels</span>
          </div>
          <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5 scrollbar-thin">
          {loading ? (
            <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
          ) : error ? (
            <div className="py-8 text-center text-red-400">❌ {error}</div>
          ) : (
            <>
              <div className="mb-4">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-widest text-slate-500">已建造的港口</h3>
                {Object.keys(channels).length === 0 ? (
                  <p className="text-sm text-slate-600">还没有港口。点击下方建造第一个。</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(channels).map(([channelType, config]) => {
                      const channelDef = getChannelDefinition(channelType);
                      const editForm = editForms[channelType] || buildChannelForm(channelType, config);
                      const isEditing = editingChannel === channelType;
                      const busy = savingKey === `channel:update:${channelType}` || savingKey === `channel:remove:${channelType}`;

                      return (
                        <div key={channelType} className="space-y-3 rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <span className="text-lg">{channelDef?.icon ?? '📡'}</span>
                                <div>
                                  <p className="text-sm font-medium text-slate-200">{channelDef?.label ?? channelType}</p>
                                  <p className="text-[11px] text-slate-500">{channelType}</p>
                                </div>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${config.enabled !== false ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-500'}`}>
                                  {config.enabled !== false ? '🔥 在线' : '⏸️ 停用'}
                                </span>
                              </div>
                              <div className="space-y-1 rounded-lg bg-slate-950/60 px-3 py-2 text-xs">
                                {config.baseUrl && <InfoRow label="地址" value={formatChannelValue(config.baseUrl)} />}
                                {config.botToken && <InfoRow label="Token" value={formatChannelValue(config.botToken)} />}
                                {config.appToken && <InfoRow label="App Token" value={formatChannelValue(config.appToken)} />}
                                {config.apiKey && <InfoRow label="API Key" value={formatChannelValue(config.apiKey)} />}
                                {config.dmPolicy && <InfoRow label="DM" value={formatChannelValue(config.dmPolicy)} />}
                                {config.groupPolicy && <InfoRow label="群组" value={formatChannelValue(config.groupPolicy)} />}
                                {config.chatmode && <InfoRow label="模式" value={formatChannelValue(config.chatmode)} />}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  void handleChannelTest(channelType);
                                }}
                                disabled={testingChannel === channelType}
                                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                              >
                                {testingChannel === channelType ? '⏳ 测试中' : '🔌 测试'}
                              </button>
                              <button
                                onClick={() => openEditForm(channelType)}
                                className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20"
                              >
                                {isEditing ? '收起编辑' : '✏️ 编辑'}
                              </button>
                              <HoldButton
                                label="🗑️ 删除"
                                onComplete={() => {
                                  void handleRemoveChannel(channelType);
                                }}
                                disabled={busy}
                                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                              />
                            </div>
                          </div>

                          {isEditing && (
                            <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/70 p-3">
                              <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-400">Edit Channel</p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                {channelDef?.fields.map((field) => (
                                  <Field key={field} label={FIELD_LABELS[field] || field} className={field === 'baseUrl' ? 'sm:col-span-2' : ''}>
                                    <Input
                                      type={isSecretField(field) ? 'password' : 'text'}
                                      value={editForm[field] || ''}
                                      placeholder={FIELD_PLACEHOLDERS[field] || ''}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setEditForms((prev) => ({
                                          ...prev,
                                          [channelType]: {
                                            ...(prev[channelType] || buildChannelForm(channelType, config)),
                                            [field]: value,
                                          },
                                        }));
                                      }}
                                    />
                                  </Field>
                                ))}
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <button
                                  onClick={() => {
                                    void handleSaveEdit(channelType);
                                  }}
                                  disabled={savingKey === `channel:update:${channelType}`}
                                  className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                                >
                                  {savingKey === `channel:update:${channelType}` ? '⏳ 保存中...' : '💾 保存'}
                                </button>
                                <button
                                  onClick={() => setEditingChannel(null)}
                                  className="rounded-lg border border-slate-700/60 px-3 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}

                          {testResults[channelType] && (
                            <div className={`rounded-lg px-3 py-2 text-[11px] font-mono ${testResults[channelType].ok ? 'bg-emerald-900/20 text-emerald-400' : 'bg-red-900/20 text-red-400'}`}>
                              {testResults[channelType].message}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {!showAddPanel ? (
                <button
                  onClick={() => setShowAddPanel(true)}
                  className="w-full rounded-xl border-2 border-dashed border-slate-700/50 py-4 text-sm text-slate-500 transition-colors hover:border-sky-500/50 hover:text-sky-400"
                >
                  🏗️ 建造新港口
                </button>
              ) : (
                <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4">
                  <h4 className="mb-3 text-xs font-medium text-sky-400">🏗️ 建造新港口</h4>

                  {!selectedType ? (
                    <div className="grid grid-cols-3 gap-2">
                      {CHANNEL_TYPES.filter((type) => !channels[type.id]).map((type) => (
                        <button
                          key={type.id}
                          onClick={() => {
                            setSelectedType(type.id);
                            setFormData(buildChannelForm(type.id));
                          }}
                          className="flex flex-col items-center gap-1 rounded-xl border border-slate-700/40 bg-slate-900/50 p-3 transition-colors hover:border-sky-500/40 hover:bg-slate-800/50"
                        >
                          <span className="text-2xl">{type.icon}</span>
                          <span className="text-[11px] text-slate-400">{type.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{getChannelDefinition(selectedType)?.icon}</span>
                        <span className="text-sm font-medium text-slate-200">{getChannelDefinition(selectedType)?.label}</span>
                        <button
                          onClick={() => {
                            setSelectedType(null);
                            setFormData({});
                          }}
                          className="text-xs text-slate-500 hover:text-slate-300"
                        >
                          ← 返回
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {getChannelDefinition(selectedType)?.fields.map((field) => (
                          <Field key={field} label={FIELD_LABELS[field] || field} className={field === 'baseUrl' ? 'sm:col-span-2' : ''}>
                            <Input
                              type={isSecretField(field) ? 'password' : 'text'}
                              placeholder={FIELD_PLACEHOLDERS[field] || ''}
                              value={formData[field] || ''}
                              onChange={(event) => setFormData((prev) => ({ ...prev, [field]: event.target.value }))}
                            />
                          </Field>
                        ))}
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => {
                            setShowAddPanel(false);
                            setSelectedType(null);
                            setFormData({});
                          }}
                          className="flex-1 rounded-lg border border-slate-700/50 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => {
                            void handleAddChannel();
                          }}
                          disabled={savingKey === `channel:add:${selectedType}`}
                          className="flex-1 rounded-lg bg-sky-600 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                        >
                          {savingKey === `channel:add:${selectedType}` ? '⏳ 建造中...' : '⚒️ 建造'}
                        </button>
                      </div>
                    </div>
                  )}

                  {!selectedType && (
                    <button
                      onClick={() => setShowAddPanel(false)}
                      className="mt-2 w-full text-center text-xs text-slate-500 hover:text-slate-300"
                    >
                      取消
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 space-y-3 rounded-xl border border-slate-700/30 bg-slate-900/30 p-3">
                <div>
                  <p className="text-sm font-medium text-slate-100">通讯设置</p>
                  <p className="text-[11px] text-slate-500">消息行为、语音合成和 Webhook 配置已直接并入频道港口。</p>
                </div>

                <CollapsibleSection icon="💬" title="消息行为" subtitle="messages">
                  <MessagesForm config={config} onConfigRefresh={loadConfig} />
                </CollapsibleSection>

                <CollapsibleSection icon="🔊" title="语音合成" subtitle="messages.tts">
                  <TtsForm config={config} onConfigRefresh={loadConfig} />
                </CollapsibleSection>

                <CollapsibleSection icon="🪝" title="Webhooks" subtitle="hooks">
                  <HooksForm config={config} onConfigRefresh={loadConfig} />
                </CollapsibleSection>
              </div>
            </>
          )}
        </div>

        {actionResult && (
          <div className={`mx-5 mb-3 rounded-lg px-4 py-2 text-xs ${actionResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {actionResult.ok ? '✅' : '❌'} {actionResult.message}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-700/40 px-5 py-3">
          <span className="text-[10px] text-slate-600">频道变更需要重启 Gateway 生效</span>
          <HoldButton
            label="🔄 重启 Gateway"
            onComplete={() => {
              void handleRestartGateway();
            }}
            disabled={savingKey === 'gateway:restart'}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="block text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="break-all text-right font-mono text-[11px] text-slate-300">{value}</span>
    </div>
  );
}

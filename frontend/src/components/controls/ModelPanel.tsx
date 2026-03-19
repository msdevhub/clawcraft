import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { HoldButton } from '@/components/ui/HoldButton';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/auth-fetch';
import { useWorldStore } from '@/store/world-store';

interface ModelPanelProps {
  onClose: () => void;
}

interface ProviderConfig {
  api?: string;
  apiKey?: string;
  auth?: string;
  baseUrl?: string;
  baseURL?: string;
  defaultModel?: string;
  model?: string;
  models?: string[] | { default?: string };
  type?: string;
  [key: string]: any;
}

interface ProviderFormState {
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

const EMPTY_FORM: ProviderFormState = {
  name: '',
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
};

function readDefaultModel(provider: ProviderConfig | undefined): string {
  if (!provider) return '';
  if (typeof provider.defaultModel === 'string') return provider.defaultModel;
  if (typeof provider.model === 'string') return provider.model;
  if (Array.isArray(provider.models) && typeof provider.models[0] === 'string') return provider.models[0];
  if (provider.models && !Array.isArray(provider.models) && typeof provider.models.default === 'string') {
    return provider.models.default;
  }
  return '';
}

function buildProviderForm(name: string, provider: ProviderConfig | undefined): ProviderFormState {
  return {
    name,
    baseUrl: provider?.baseUrl || provider?.baseURL || '',
    apiKey: '',
    defaultModel: readDefaultModel(provider),
  };
}

function maskApiKey(value?: string): string {
  if (!value) return '未设置';
  if (value.startsWith('***')) return value;
  return `***${value.slice(-6)}`;
}

export function ModelPanel({ onClose }: ModelPanelProps) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ProviderFormState>(EMPTY_FORM);
  const [editForms, setEditForms] = useState<Record<string, ProviderFormState>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const addEvent = useWorldStore((s) => s.addEvent);

  const loadConfig = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const response = await authFetch('/clawcraft/config');
      const data = await response.json();
      if (data.ok) setConfig(data.config);
      else setActionResult({ ok: false, message: data.error || '读取模型配置失败' });
    } catch (err: any) {
      setActionResult({ ok: false, message: err.message || '读取模型配置失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig(true);
  }, [loadConfig]);

  const providers = (config?.models?.providers || {}) as Record<string, ProviderConfig>;
  const providerEntries = Object.entries(providers);

  const updateEditForm = useCallback((providerName: string, field: keyof ProviderFormState, value: string) => {
    setEditForms((prev) => ({
      ...prev,
      [providerName]: {
        ...(prev[providerName] || buildProviderForm(providerName, providers[providerName])),
        [field]: value,
      },
    }));
  }, [providers]);

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

  const handleTestProvider = useCallback(async (providerName: string) => {
    setTesting(providerName);
    setTestResults((prev) => ({ ...prev, [providerName]: { ok: true, message: '⏳ 连接测试中...' } }));

    try {
      const response = await authFetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'model.test', params: { provider: providerName } }),
      });
      const data = await response.json();
      const message = data.ok ? `✅ ${data.message || '连接正常'}` : `❌ ${data.error || '连接失败'}`;
      setTestResults((prev) => ({ ...prev, [providerName]: { ok: Boolean(data.ok), message } }));

      if (data.ok) {
        addEvent({
          id: `model-test-${Date.now()}`,
          type: 'info',
          message: `⚗️ ${providerName} 连接测试通过`,
          ts: Date.now(),
        });
      }
    } catch (err: any) {
      setTestResults((prev) => ({ ...prev, [providerName]: { ok: false, message: `❌ ${err.message}` } }));
    } finally {
      setTesting(null);
    }
  }, [addEvent]);

  const handleAddProvider = useCallback(async () => {
    const name = addForm.name.trim();
    if (!name) {
      setActionResult({ ok: false, message: '提供商名称不能为空' });
      return;
    }

    const result = await executeAction(
      'model.add',
      {
        name,
        baseUrl: addForm.baseUrl.trim(),
        apiKey: addForm.apiKey.trim(),
        defaultModel: addForm.defaultModel.trim(),
      },
      'model:add',
      `⚗️ 已添加 ${name}`,
    );

    if (result?.ok) {
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
    }
  }, [addForm, executeAction]);

  const handleEditProvider = useCallback(async (providerName: string) => {
    const form = editForms[providerName] || buildProviderForm(providerName, providers[providerName]);
    const params: Record<string, string> = {
      provider: providerName,
      baseUrl: form.baseUrl.trim(),
      defaultModel: form.defaultModel.trim(),
    };

    if (form.apiKey.trim()) params.apiKey = form.apiKey.trim();

    const result = await executeAction(
      'model.update',
      params,
      `model:update:${providerName}`,
      `⚗️ 已更新 ${providerName}`,
    );

    if (result?.ok) {
      setEditingProvider(null);
      setEditForms((prev) => {
        const next = { ...prev };
        delete next[providerName];
        return next;
      });
    }
  }, [editForms, executeAction, providers]);

  const handleRemoveProvider = useCallback(async (providerName: string) => {
    const result = await executeAction(
      'model.remove',
      { provider: providerName },
      `model:remove:${providerName}`,
      `🗑️ 已删除 ${providerName}`,
    );

    if (result?.ok) {
      setEditingProvider((current) => (current === providerName ? null : current));
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[providerName];
        return next;
      });
    }
  }, [executeAction]);

  const openEditForm = useCallback((providerName: string) => {
    setEditingProvider((current) => (current === providerName ? null : providerName));
    setEditForms((prev) => ({
      ...prev,
      [providerName]: prev[providerName] || buildProviderForm(providerName, providers[providerName]),
    }));
  }, [providers]);

  return (
    <div className="w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚗️</span>
          <h2 className="text-base font-bold text-slate-100">模型熔炉</h2>
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-400">
            {providerEntries.length} 个提供商
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
      </div>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4 scrollbar-thin">
        {loading ? (
          <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
        ) : (
          <>
            <div className="space-y-3 rounded-xl border border-slate-800/70 bg-slate-900/50 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center justify-between rounded-lg bg-slate-950/60 px-3 py-2 text-xs sm:min-w-[220px]">
                  <span className="text-slate-500">默认模型</span>
                  <span className="font-mono text-slate-300">{config?.models?.default || '未设置'}</span>
                </div>
                <button
                  onClick={() => {
                    setShowAddForm((prev) => !prev);
                    setActionResult(null);
                  }}
                  className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-500/20"
                >
                  {showAddForm ? '收起表单' : '➕ 添加提供商'}
                </button>
              </div>

              {showAddForm && (
                <div className="space-y-3 rounded-xl border border-sky-500/20 bg-slate-950/80 p-3">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-sky-400">New Provider</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="提供商名称">
                      <Input
                        value={addForm.name}
                        onChange={(event) => setAddForm((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="my-openai"
                      />
                    </Field>
                    <Field label="默认模型">
                      <Input
                        value={addForm.defaultModel}
                        onChange={(event) => setAddForm((prev) => ({ ...prev, defaultModel: event.target.value }))}
                        placeholder="gpt-4.1-mini"
                      />
                    </Field>
                    <Field className="sm:col-span-2" label="Base URL">
                      <Input
                        value={addForm.baseUrl}
                        onChange={(event) => setAddForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                        placeholder="https://api.openai.com"
                      />
                    </Field>
                    <Field className="sm:col-span-2" label="API Key">
                      <Input
                        type="password"
                        value={addForm.apiKey}
                        onChange={(event) => setAddForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                        placeholder="sk-..."
                      />
                    </Field>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={handleAddProvider}
                      disabled={savingKey === 'model:add'}
                      className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                    >
                      {savingKey === 'model:add' ? '⏳ 保存中...' : '⚒️ 保存提供商'}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddForm(false);
                        setAddForm(EMPTY_FORM);
                      }}
                      className="rounded-lg border border-slate-700/60 px-3 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>

            {providerEntries.length === 0 && !showAddForm ? (
              <p className="py-6 text-center text-sm text-slate-600">没有配置模型提供商</p>
            ) : (
              providerEntries.map(([name, provider]) => {
                const editForm = editForms[name] || buildProviderForm(name, provider);
                const isEditing = editingProvider === name;
                const busy = savingKey === `model:update:${name}` || savingKey === `model:remove:${name}`;
                return (
                  <div key={name} className="space-y-3 rounded-xl border border-slate-700/30 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🧠</span>
                          <p className="text-sm font-medium text-slate-200">{name}</p>
                        </div>
                        <div className="space-y-1 text-xs text-slate-500">
                          {provider.type && <InfoRow label="类型" value={provider.type} />}
                          {(provider.baseUrl || provider.baseURL) && <InfoRow label="端点" value={provider.baseUrl || provider.baseURL} />}
                          <InfoRow label="默认模型" value={readDefaultModel(provider) || '未设置'} />
                          <InfoRow label="API Key" value={maskApiKey(provider.apiKey)} />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleTestProvider(name)}
                          disabled={testing === name}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          {testing === name ? '⏳ 测试中' : '🧪 测试连接'}
                        </button>
                        <button
                          onClick={() => openEditForm(name)}
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20"
                        >
                          {isEditing ? '收起编辑' : '✏️ 编辑'}
                        </button>
                        <HoldButton
                          label="🗑️ 删除"
                          onComplete={() => {
                            void handleRemoveProvider(name);
                          }}
                          disabled={busy}
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                        />
                      </div>
                    </div>

                    {isEditing && (
                      <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/70 p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="提供商名称">
                            <Input value={name} disabled />
                          </Field>
                          <Field label="默认模型">
                            <Input
                              value={editForm.defaultModel}
                              onChange={(event) => updateEditForm(name, 'defaultModel', event.target.value)}
                              placeholder="gpt-4.1-mini"
                            />
                          </Field>
                          <Field className="sm:col-span-2" label="Base URL">
                            <Input
                              value={editForm.baseUrl}
                              onChange={(event) => updateEditForm(name, 'baseUrl', event.target.value)}
                              placeholder="https://api.openai.com"
                            />
                          </Field>
                          <Field className="sm:col-span-2" label="API Key">
                            <Input
                              type="password"
                              value={editForm.apiKey}
                              onChange={(event) => updateEditForm(name, 'apiKey', event.target.value)}
                              placeholder="留空则保留当前密钥"
                            />
                          </Field>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <button
                            onClick={() => {
                              void handleEditProvider(name);
                            }}
                            disabled={savingKey === `model:update:${name}`}
                            className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                          >
                            {savingKey === `model:update:${name}` ? '⏳ 保存中...' : '💾 保存修改'}
                          </button>
                          <button
                            onClick={() => setEditingProvider(null)}
                            className="rounded-lg border border-slate-700/60 px-3 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}

                    {testResults[name] && (
                      <div className={`rounded-lg p-2 text-[11px] font-mono ${testResults[name].ok ? 'bg-emerald-900/20 text-emerald-400' : 'bg-red-900/20 text-red-400'}`}>
                        {testResults[name].message}
                      </div>
                    )}
                  </div>
                );
              })
            )}

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

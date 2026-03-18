import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { useWorldStore } from '@/store/world-store';

interface EnvPanelProps {
  onClose: () => void;
}

interface EnvRow {
  id: string;
  key: string;
  value: string;
}

interface ToastState {
  ok: boolean;
  message: string;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEnvRows(config: any): EnvRow[] {
  const env = isRecord(config?.env) ? config.env : {};
  return Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value], index) => ({
      id: `${key}-${index}`,
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
}

export function EnvPanel({ onClose }: EnvPanelProps) {
  const addEvent = useWorldStore((s) => s.addEvent);

  const [config, setConfig] = useState<any>(null);
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const loadConfig = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);

    try {
      const response = await fetch('/clawcraft/config');
      const data = await response.json();
      if (!data.ok) {
        setToast({ ok: false, message: data.error || '读取配置失败' });
        return;
      }

      setConfig(data.config);
      setRows(readEnvRows(data.config));
    } catch (err: any) {
      setToast({ ok: false, message: err.message || '读取配置失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig(true);
  }, [loadConfig]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleSave = useCallback(async () => {
    const env: Record<string, string> = {};

    for (const row of rows) {
      const key = row.key.trim();
      if (!key) continue;
      env[key] = row.value;
    }

    setSaving(true);
    setToast(null);

    try {
      const response = await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'config.update',
          params: {
            path: 'env',
            value: env,
          },
        }),
      });
      const data = await response.json();

      if (!data.ok) {
        setToast({ ok: false, message: data.error || '保存失败' });
        return;
      }

      const restartSuffix = data.data?.needsRestart ? '，需重启 Gateway 生效' : '';
      setToast({ ok: true, message: `环境变量已更新${restartSuffix}` });
      addEvent({
        id: `env-${Date.now()}`,
        type: 'info',
        message: `🌿 环境变量已更新${restartSuffix}`,
        ts: Date.now(),
      });
      await loadConfig();
    } catch (err: any) {
      setToast({ ok: false, message: err.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  }, [addEvent, loadConfig, rows]);

  return (
    <div className="relative w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">🌿</span>
          <div>
            <h2 className="text-base font-bold text-slate-100">环境变量</h2>
            <p className="text-[11px] text-slate-500">写入 `env`</p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4 scrollbar-thin">
        {loading ? (
          <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 p-3 text-xs">
              <InfoRow label="变量数" value={`${rows.length}`} />
              <InfoRow label="最后版本" value={config?.meta?.lastTouchedVersion || 'unknown'} />
            </div>

            <div className="space-y-3 rounded-xl border border-slate-700/30 bg-slate-900/30 p-3">
              {rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-700/50 px-3 py-4 text-center text-xs text-slate-500">
                  暂无环境变量，点击下方按钮添加。
                </p>
              ) : (
                rows.map((row) => (
                  <div key={row.id} className="grid gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3 sm:grid-cols-[1fr_1.5fr_auto]">
                    <Field label="Key">
                      <Input
                        value={row.key}
                        onChange={(event) => {
                          const value = event.target.value;
                          setRows((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, key: value } : entry));
                        }}
                        placeholder="OPENAI_API_KEY"
                      />
                    </Field>
                    <Field label="Value">
                      <Input
                        value={row.value}
                        onChange={(event) => {
                          const value = event.target.value;
                          setRows((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, value } : entry));
                        }}
                        placeholder="value"
                      />
                    </Field>
                    <div className="flex items-end">
                      <button
                        onClick={() => setRows((prev) => prev.filter((entry) => entry.id !== row.id))}
                        className="h-11 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs text-red-300 transition-colors hover:bg-red-500/20"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => {
                    setRows((prev) => [
                      ...prev,
                      { id: `env-${Date.now()}-${prev.length}`, key: '', value: '' },
                    ]);
                  }}
                  className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300 transition-colors hover:bg-sky-500/20"
                >
                  ➕ 添加变量
                </button>
                <button
                  onClick={() => { void handleSave(); }}
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? '⏳ 保存中...' : '💾 保存环境变量'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className={`pointer-events-none absolute bottom-4 right-4 rounded-lg border px-3 py-2 text-xs shadow-lg ${
          toast.ok
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
            : 'border-red-500/40 bg-red-500/15 text-red-300'
        }`}>
          {toast.ok ? '✅' : '❌'} {toast.message}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
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

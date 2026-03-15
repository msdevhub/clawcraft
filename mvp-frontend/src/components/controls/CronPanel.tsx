import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { useWorldStore } from '@/store/world-store';

interface CronPanelProps {
  onClose: () => void;
}

interface CronJob {
  id: string;
  jobId?: string;
  name?: string;
  enabled?: boolean;
  agentId?: string;
  sessionTarget?: 'main' | 'isolated';
  wakeMode?: 'now' | 'next-heartbeat';
  lightContext?: boolean;
  deleteAfterRun?: boolean;
  delivery?: {
    mode?: string;
    channel?: string;
    to?: string;
  };
  payload?: {
    kind?: string;
    text?: string;
    message?: string;
    model?: string;
  };
  schedule?: {
    kind?: 'cron' | 'every' | 'at';
    expr?: string;
    at?: string;
    atMs?: number;
    everyMs?: number;
    tz?: string;
  };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastRunStatus?: string;
    lastDurationMs?: number;
    lastError?: string;
    lastDeliveryStatus?: string;
    lastDelivered?: boolean;
    consecutiveErrors?: number;
  };
}

interface CronRun {
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
  status?: string;
  error?: string;
  summary?: string;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface ActionResponse {
  ok: boolean;
  message?: string;
  error?: string;
  data?: any;
}

type ScheduleKind = 'cron' | 'every' | 'at';
type SessionTarget = 'isolated' | 'main';
type WakeMode = 'now' | 'next-heartbeat';

interface CronFormState {
  name: string;
  scheduleKind: ScheduleKind;
  scheduleValue: string;
  tz: string;
  sessionTarget: SessionTarget;
  message: string;
  agentId: string;
  model: string;
  thinking: string;
  channel: string;
  to: string;
  announce: boolean;
  lightContext: boolean;
  deleteAfterRun: boolean;
  wakeMode: WakeMode;
}

const DEFAULT_FORM: CronFormState = {
  name: '',
  scheduleKind: 'cron',
  scheduleValue: '0 7 * * *',
  tz: 'Asia/Shanghai',
  sessionTarget: 'isolated',
  message: '',
  agentId: '',
  model: '',
  thinking: 'off',
  channel: 'mattermost',
  to: '',
  announce: false,
  lightContext: false,
  deleteAfterRun: false,
  wakeMode: 'now',
};

const inputClassName = 'h-10 rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-400/50';
const selectClassName = `w-full ${inputClassName}`;
const textareaClassName = 'min-h-[120px] w-full rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-400/50';

function getJobId(job: CronJob) {
  return job.id || job.jobId || '';
}

function getJobName(job: CronJob) {
  return job.name || getJobId(job) || 'Unnamed Job';
}

function getJobMessage(job: CronJob) {
  return job.payload?.message || job.payload?.text || '';
}

function formatSchedule(job: CronJob) {
  const schedule = job.schedule;
  if (!schedule) return '未配置 schedule';
  if (schedule.expr) return schedule.tz ? `${schedule.expr} (${schedule.tz})` : schedule.expr;
  if (schedule.at) return schedule.tz ? `${schedule.at} (${schedule.tz})` : schedule.at;
  if (typeof schedule.atMs === 'number') {
    const text = formatDateTime(schedule.atMs);
    return schedule.tz ? `${text} (${schedule.tz})` : text;
  }
  if (typeof schedule.everyMs === 'number') return `every ${formatInterval(schedule.everyMs)}`;
  return '未配置 schedule';
}

function formatInterval(value: number) {
  if (!Number.isFinite(value) || value <= 0) return `${value}ms`;
  if (value % 86_400_000 === 0) return `${value / 86_400_000}d`;
  if (value % 3_600_000 === 0) return `${value / 3_600_000}h`;
  if (value % 60_000 === 0) return `${value / 60_000}m`;
  if (value % 1_000 === 0) return `${value / 1_000}s`;
  return `${value}ms`;
}

function formatDuration(value?: number) {
  if (!value && value !== 0) return 'n/a';
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

function formatDateTime(value?: number) {
  if (!value) return '未运行';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(value?: number) {
  if (!value) return '未运行';
  const diff = Date.now() - value;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? '前' : '后';

  if (abs < 60_000) return `${Math.max(1, Math.round(abs / 1000))} 秒${suffix}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} 分钟${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} 小时${suffix}`;
  return `${Math.round(abs / 86_400_000)} 天${suffix}`;
}

function getJobStatus(job: CronJob) {
  if (job.enabled === false) return 'disabled';
  return job.state?.lastRunStatus || job.state?.lastStatus || 'idle';
}

function getStatusClass(status: string) {
  if (status === 'ok' || status === 'idle' || status === 'active') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (status === 'disabled') return 'bg-slate-700/40 text-slate-400 border-slate-600/40';
  if (status === 'error' || status === 'failed') return 'bg-red-500/15 text-red-300 border-red-500/30';
  return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
}

function describeDelivery(job: CronJob) {
  const sessionTarget = job.sessionTarget || 'isolated';
  const parts = [job.delivery?.channel, job.delivery?.to].filter(Boolean);
  if (job.delivery?.mode === 'announce') {
    return `${sessionTarget} -> ${parts.join(' ') || 'announce'}`;
  }
  return `${sessionTarget} -> ${parts.join(' ') || '本地执行'}`;
}

export function CronPanel({ onClose }: CronPanelProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState<CronFormState>(DEFAULT_FORM);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [loadingRuns, setLoadingRuns] = useState<Record<string, boolean>>({});
  const [runsByJobId, setRunsByJobId] = useState<Record<string, CronRun[]>>({});

  const addEvent = useWorldStore((state) => state.addEvent);

  const requestAction = useCallback(async (type: string, params: Record<string, unknown> = {}): Promise<ActionResponse> => {
    const response = await fetch('/clawcraft/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, params }),
    });
    return response.json();
  }, []);

  const loadJobs = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await requestAction('cron.list');
      if (data.ok) {
        setJobs(Array.isArray(data.data?.jobs) ? data.data.jobs : []);
      } else {
        setResult({ ok: false, message: data.error || '读取 Cron Jobs 失败' });
      }
    } catch (error: any) {
      setResult({ ok: false, message: error.message || '读取 Cron Jobs 失败' });
    } finally {
      setLoading(false);
    }
  }, [requestAction]);

  const loadRuns = useCallback(async (jobId: string, force = false) => {
    if (!jobId) return;
    if (!force && runsByJobId[jobId]) return;

    setLoadingRuns((current) => ({ ...current, [jobId]: true }));
    try {
      const data = await requestAction('cron.runs', { jobId, limit: 10 });
      if (data.ok) {
        const runs = Array.isArray(data.data?.runs) ? data.data.runs.slice().reverse() : [];
        setRunsByJobId((current) => ({ ...current, [jobId]: runs }));
      } else {
        setResult({ ok: false, message: data.error || '读取运行历史失败' });
      }
    } catch (error: any) {
      setResult({ ok: false, message: error.message || '读取运行历史失败' });
    } finally {
      setLoadingRuns((current) => ({ ...current, [jobId]: false }));
    }
  }, [requestAction, runsByJobId]);

  useEffect(() => {
    void loadJobs(true);
  }, [loadJobs]);

  const sortedJobs = useMemo(() => (
    [...jobs].sort((left, right) => {
      const leftTs = left.state?.nextRunAtMs || left.state?.lastRunAtMs || 0;
      const rightTs = right.state?.nextRunAtMs || right.state?.lastRunAtMs || 0;
      return rightTs - leftTs;
    })
  ), [jobs]);

  const emitResult = useCallback((ok: boolean, message: string) => {
    setResult({ ok, message });
    addEvent({
      id: `cron-${Date.now()}`,
      type: ok ? 'info' : 'error',
      message,
      ts: Date.now(),
    });
  }, [addEvent]);

  const invalidateRuns = useCallback((jobId: string) => {
    setRunsByJobId((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });
  }, []);

  const executeJobAction = useCallback(async (
    type: string,
    params: Record<string, unknown>,
    successMessage: string,
    key: string,
    jobId?: string,
    floatText?: { text: string; color: number },
  ) => {
    setActionKey(key);
    setResult(null);

    try {
      const data = await requestAction(type, params);
      if (!data.ok) {
        emitResult(false, data.error || '操作失败');
        return data;
      }

      emitResult(true, data.message || successMessage);
      if (floatText) {
        (window as any).__floatText?.('cron', floatText.text, floatText.color);
      }

      await loadJobs(false);
      if (jobId) {
        invalidateRuns(jobId);
        if (expandedRuns[jobId]) {
          await loadRuns(jobId, true);
        }
      }
      return data;
    } catch (error: any) {
      emitResult(false, error.message || '操作失败');
      return { ok: false, error: error.message || '操作失败' };
    } finally {
      setActionKey(null);
    }
  }, [emitResult, expandedRuns, invalidateRuns, loadJobs, loadRuns, requestAction]);

  const handleCreate = useCallback(async () => {
    if (!form.scheduleValue.trim()) {
      setResult({ ok: false, message: '请填写 schedule 表达式' });
      return;
    }
    if (!form.message.trim()) {
      setResult({ ok: false, message: '请填写提示词/消息' });
      return;
    }

    const shouldAnnounce = form.announce || Boolean(form.to.trim());
    const data = await executeJobAction(
      'cron.add',
      {
        name: form.name.trim(),
        scheduleKind: form.scheduleKind,
        scheduleValue: form.scheduleValue.trim(),
        sessionTarget: form.sessionTarget,
        message: form.message.trim(),
        tz: form.scheduleKind === 'cron' ? form.tz.trim() : '',
        announce: shouldAnnounce,
        channel: form.channel.trim(),
        to: form.to.trim(),
        agentId: form.agentId.trim(),
        model: form.model.trim(),
        thinking: form.thinking.trim(),
        lightContext: form.lightContext,
        deleteAfterRun: form.deleteAfterRun,
        wakeMode: form.wakeMode,
      },
      `⏰ 已创建 ${form.name.trim() || 'Cron Job'}`,
      'cron:create',
      undefined,
      { text: '⏰ 新任务已建成', color: 0x818cf8 },
    );

    if (data?.ok) {
      setForm(DEFAULT_FORM);
      setShowAdvanced(false);
      setShowCreateForm(false);
    }
  }, [executeJobAction, form]);

  const toggleRuns = useCallback((jobId: string) => {
    const nextExpanded = !expandedRuns[jobId];
    setExpandedRuns((current) => ({ ...current, [jobId]: nextExpanded }));
    if (nextExpanded) {
      void loadRuns(jobId, true);
    }
  }, [expandedRuns, loadRuns]);

  return (
    <div className="w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">⏰</span>
          <h2 className="text-base font-bold text-slate-100">时光钟塔</h2>
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
            {jobs.length} 个任务
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
      </div>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4 scrollbar-thin">
        <div className="rounded-xl border border-indigo-500/20 bg-slate-900/60 p-3">
          <button
            onClick={() => {
              setShowCreateForm((current) => !current);
              setResult(null);
            }}
            className="w-full rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
          >
            {showCreateForm ? '收起创建表单' : '＋ 添加任务'}
          </button>

          {showCreateForm && (
            <div className="mt-3 space-y-3 rounded-xl border border-slate-700/60 bg-slate-950/80 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="名称">
                  <Input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Morning Brief"
                  />
                </Field>
                <Field label="执行方式">
                  <div className="grid grid-cols-2 gap-2">
                    {(['isolated', 'main'] as const).map((target) => (
                      <button
                        key={target}
                        onClick={() => setForm((current) => ({ ...current, sessionTarget: target }))}
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                          form.sessionTarget === target
                            ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
                            : 'border-slate-700/70 bg-slate-900/70 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {target}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <Field label="类型">
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['cron', '定时 cron'],
                    ['every', '间隔 every'],
                    ['at', '一次性 at'],
                  ] as const).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => setForm((current) => ({ ...current, scheduleKind: kind }))}
                      className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                        form.scheduleKind === kind
                          ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
                          : 'border-slate-700/70 bg-slate-900/70 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="表达式">
                  <input
                    className={inputClassName}
                    value={form.scheduleValue}
                    onChange={(event) => setForm((current) => ({ ...current, scheduleValue: event.target.value }))}
                    placeholder={form.scheduleKind === 'cron' ? '0 7 * * *' : form.scheduleKind === 'every' ? '30m' : '2026-03-15T07:00:00+08:00'}
                  />
                </Field>
                <Field label="时区">
                  <input
                    className={inputClassName}
                    value={form.tz}
                    onChange={(event) => setForm((current) => ({ ...current, tz: event.target.value }))}
                    placeholder="Asia/Shanghai"
                    disabled={form.scheduleKind !== 'cron'}
                  />
                </Field>
              </div>

              <Field label="提示词 / 消息">
                <textarea
                  className={textareaClassName}
                  value={form.message}
                  onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                  placeholder={form.sessionTarget === 'main' ? '[System Event] It is 8:00 AM...' : 'Write a summary and deliver it to Dad...'}
                />
              </Field>

              <button
                onClick={() => setShowAdvanced((current) => !current)}
                className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
              >
                {showAdvanced ? '▾ 收起高级选项' : '▸ 高级选项'}
              </button>

              {showAdvanced && (
                <div className="grid gap-3 rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 sm:grid-cols-2">
                  <Field label="Agent">
                    <input
                      className={inputClassName}
                      value={form.agentId}
                      onChange={(event) => setForm((current) => ({ ...current, agentId: event.target.value }))}
                      placeholder="main"
                      disabled={form.sessionTarget === 'main'}
                    />
                  </Field>
                  <Field label="Wake">
                    <select
                      className={selectClassName}
                      value={form.wakeMode}
                      onChange={(event) => setForm((current) => ({ ...current, wakeMode: event.target.value as WakeMode }))}
                    >
                      <option value="now">now</option>
                      <option value="next-heartbeat">next-heartbeat</option>
                    </select>
                  </Field>
                  <Field label="Model">
                    <input
                      className={inputClassName}
                      value={form.model}
                      onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                      placeholder="provider/model"
                      disabled={form.sessionTarget === 'main'}
                    />
                  </Field>
                  <Field label="Thinking">
                    <select
                      className={selectClassName}
                      value={form.thinking}
                      onChange={(event) => setForm((current) => ({ ...current, thinking: event.target.value }))}
                      disabled={form.sessionTarget === 'main'}
                    >
                      <option value="off">off</option>
                      <option value="minimal">minimal</option>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </Field>
                  <Field label="投递渠道">
                    <input
                      className={inputClassName}
                      value={form.channel}
                      onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))}
                      placeholder="mattermost"
                    />
                  </Field>
                  <Field label="投递目标">
                    <input
                      className={inputClassName}
                      value={form.to}
                      onChange={(event) => setForm((current) => ({ ...current, to: event.target.value }))}
                      placeholder="@dora / channel id"
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.announce}
                      onChange={(event) => setForm((current) => ({ ...current, announce: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-400"
                    />
                    发送结果到聊天
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.lightContext}
                      onChange={(event) => setForm((current) => ({ ...current, lightContext: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-400"
                      disabled={form.sessionTarget === 'main'}
                    />
                    轻量上下文
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.deleteAfterRun}
                      onChange={(event) => setForm((current) => ({ ...current, deleteAfterRun: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-400"
                    />
                    运行后删除
                  </label>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setShowAdvanced(false);
                    setForm(DEFAULT_FORM);
                  }}
                  className="flex-1 rounded-xl border border-slate-700/70 px-4 py-2 text-sm text-slate-400 transition-colors hover:text-slate-100"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={actionKey === 'cron:create'}
                  className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  {actionKey === 'cron:create' ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
        ) : sortedJobs.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 px-4 py-8 text-center">
            <p className="text-3xl">⏰</p>
            <p className="mt-2 text-sm text-slate-400">时光钟塔尚未设定任务</p>
            <p className="mt-1 text-xs text-slate-600">添加第一个 Cron Job，让王国自动运转</p>
          </div>
        ) : (
          sortedJobs.map((job) => {
            const jobId = getJobId(job);
            const status = getJobStatus(job);
            const runs = runsByJobId[jobId] || [];
            const isExpanded = Boolean(expandedRuns[jobId]);
            return (
              <div key={jobId} className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-100">📋 {getJobName(job)}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getStatusClass(status)}`}>
                        {status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">⏱ {formatSchedule(job)}</p>
                    <p className="mt-1 text-xs text-slate-500">🎯 {describeDelivery(job)}</p>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <div>下次运行</div>
                    <div className="text-slate-300">{formatDateTime(job.state?.nextRunAtMs)}</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 rounded-xl border border-slate-800/70 bg-slate-950/50 p-3 text-xs text-slate-400">
                  <div className="flex items-center justify-between gap-3">
                    <span>上次运行</span>
                    <span className="text-slate-200">
                      {formatRelativeTime(job.state?.lastRunAtMs)}
                      {job.state?.lastRunAtMs ? ` · ${formatDuration(job.state?.lastDurationMs)}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>消息</span>
                    <span className="max-w-[68%] truncate text-right text-slate-300">{getJobMessage(job) || '无'}</span>
                  </div>
                  {job.state?.lastError && (
                    <div className="rounded-lg bg-red-500/10 px-3 py-2 text-red-300">
                      {job.state.lastError}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void executeJobAction(
                      'cron.run',
                      { jobId },
                      `⏯ 已运行 ${getJobName(job)}`,
                      `cron:run:${jobId}`,
                      jobId,
                      { text: '▶ 手动运行', color: 0x22c55e },
                    )}
                    disabled={actionKey === `cron:run:${jobId}`}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {actionKey === `cron:run:${jobId}` ? '运行中...' : '▶ 运行'}
                  </button>
                  <button
                    onClick={() => void executeJobAction(
                      'cron.toggle',
                      { jobId, enabled: job.enabled === false },
                      `⏰ ${getJobName(job)} 已${job.enabled === false ? '启用' : '停用'}`,
                      `cron:toggle:${jobId}`,
                      jobId,
                      { text: job.enabled === false ? '✅ 已启用' : '⏸ 已停用', color: job.enabled === false ? 0x22c55e : 0xf59e0b },
                    )}
                    disabled={actionKey === `cron:toggle:${jobId}`}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {actionKey === `cron:toggle:${jobId}` ? '处理中...' : job.enabled === false ? '▶ 启用' : '⏸ 禁用'}
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm(`确定删除任务 “${getJobName(job)}” 吗？`)) return;
                      void executeJobAction(
                        'cron.remove',
                        { jobId },
                        `🗑 已删除 ${getJobName(job)}`,
                        `cron:remove:${jobId}`,
                        jobId,
                        { text: '🗑 已删除', color: 0xef4444 },
                      );
                    }}
                    disabled={actionKey === `cron:remove:${jobId}`}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {actionKey === `cron:remove:${jobId}` ? '删除中...' : '🗑 删除'}
                  </button>
                  <button
                    onClick={() => toggleRuns(jobId)}
                    className="rounded-lg border border-slate-700/70 bg-slate-950/70 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800"
                  >
                    {isExpanded ? '📜 收起历史' : '📜 运行历史'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-3 space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/70 p-3">
                    {loadingRuns[jobId] ? (
                      <div className="py-4 text-center text-xs text-slate-500">⏳ 加载运行历史...</div>
                    ) : runs.length === 0 ? (
                      <div className="py-4 text-center text-xs text-slate-600">暂无运行历史</div>
                    ) : (
                      runs.map((run, index) => (
                        <div key={`${jobId}-${run.ts || run.runAtMs || index}`} className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-3">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className={`rounded-full border px-2 py-0.5 font-medium ${getStatusClass(run.status || 'idle')}`}>
                              {run.status || 'unknown'}
                            </span>
                            <span className="text-slate-500">{formatDateTime(run.runAtMs || run.ts)}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                            <span>耗时 {formatDuration(run.durationMs)}</span>
                            {run.model && <span>模型 {run.model}</span>}
                            {run.usage?.total_tokens && <span>Tokens {run.usage.total_tokens}</span>}
                          </div>
                          {run.error && (
                            <p className="mt-2 text-[11px] text-red-300">{run.error}</p>
                          )}
                          {run.summary && (
                            <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">{run.summary}</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {result && (
        <div className={`mx-4 mb-4 rounded-xl px-4 py-2 text-xs ${result.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
          {result.ok ? '✅' : '❌'} {result.message}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

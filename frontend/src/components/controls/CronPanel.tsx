import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { authFetch } from '@/lib/auth-fetch';
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
type PanelTab = 'overview' | 'jobs';

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

const inputClassName =
  'h-10 rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/50';
const selectClassName = `w-full ${inputClassName}`;
const textareaClassName =
  'min-h-[120px] w-full rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/50';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TIMELINE_COLORS = [
  'text-sky-300 border-sky-500/40 bg-sky-500/10',
  'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  'text-amber-300 border-amber-500/40 bg-amber-500/10',
  'text-rose-300 border-rose-500/40 bg-rose-500/10',
  'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
  'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10',
];

function getJobId(job: CronJob) {
  return job.id || job.jobId || '';
}

function getJobName(job: CronJob) {
  return job.name || getJobId(job) || 'Unnamed Job';
}

function getJobMessage(job: CronJob) {
  return job.payload?.message || job.payload?.text || '';
}

function getScheduleKind(job: CronJob): ScheduleKind | null {
  if (job.schedule?.kind) return job.schedule.kind;
  if (typeof job.schedule?.everyMs === 'number') return 'every';
  if (job.schedule?.expr) return 'cron';
  if (typeof job.schedule?.atMs === 'number' || job.schedule?.at) return 'at';
  return null;
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

function formatDateTimeWithSeconds(value?: number) {
  if (!value) return '未运行';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelativeTime(value?: number) {
  if (!value) return '未运行';
  const diff = Date.now() - value;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? '前' : '后';

  if (abs < MINUTE_MS) return `${Math.max(1, Math.round(abs / 1000))} 秒${suffix}`;
  if (abs < HOUR_MS) return `${Math.round(abs / MINUTE_MS)} 分钟${suffix}`;
  if (abs < DAY_MS) return `${Math.round(abs / HOUR_MS)} 小时${suffix}`;
  return `${Math.round(abs / DAY_MS)} 天${suffix}`;
}

function formatCountdown(targetMs: number | null, now: number) {
  if (!targetMs) return '暂无计划';
  const diff = targetMs - now;
  if (diff <= 0) return '即将运行';
  if (diff < MINUTE_MS) return `${Math.max(1, Math.ceil(diff / 1000))} 秒后`;
  if (diff < HOUR_MS) return `${Math.ceil(diff / MINUTE_MS)} 分钟后`;
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    const minutes = Math.ceil((diff % HOUR_MS) / MINUTE_MS);
    return minutes > 0 ? `${hours}小时 ${minutes}分钟后` : `${hours}小时后`;
  }
  const days = Math.floor(diff / DAY_MS);
  const hours = Math.ceil((diff % DAY_MS) / HOUR_MS);
  return hours > 0 ? `${days}天 ${hours}小时后` : `${days}天后`;
}

function getJobStatus(job: CronJob) {
  if (job.enabled === false) return 'disabled';
  return job.state?.lastRunStatus || job.state?.lastStatus || 'idle';
}

function getStatusClass(status: string) {
  if (status === 'ok' || status === 'idle' || status === 'active') {
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  }
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

function startOfDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(value: number) {
  return startOfDay(value) + DAY_MS;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function limitPoints(points: number[], maxPoints = 48) {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const limited = new Set<number>();
  for (let index = 0; index < maxPoints; index += 1) {
    limited.add(points[Math.round(index * step)]);
  }
  return Array.from(limited).sort((left, right) => left - right);
}

function expandCronField(field: string, min: number, max: number, isDayOfWeek = false) {
  const values = new Set<number>();
  const segments = field.split(',');

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    let rangePart = segment;
    let step = 1;
    if (segment.includes('/')) {
      const [base, stepText] = segment.split('/');
      rangePart = base || '*';
      const parsedStep = Number.parseInt(stepText, 10);
      if (!Number.isFinite(parsedStep) || parsedStep <= 0) {
        return null;
      }
      step = parsedStep;
    }

    let rangeStart = min;
    let rangeEnd = max;

    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [startText, endText] = rangePart.split('-');
        rangeStart = Number.parseInt(startText, 10);
        rangeEnd = Number.parseInt(endText, 10);
      } else {
        rangeStart = Number.parseInt(rangePart, 10);
        rangeEnd = rangeStart;
      }
    }

    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) {
      return null;
    }

    if (isDayOfWeek) {
      if (rangeStart === 7) rangeStart = 0;
      if (rangeEnd === 7) rangeEnd = 0;
    }

    if (rangeStart > rangeEnd && !isDayOfWeek) {
      return null;
    }

    if (isDayOfWeek && rangeStart > rangeEnd) {
      for (let value = rangeStart; value <= max; value += step) values.add(value === 7 ? 0 : value);
      for (let value = min; value <= rangeEnd; value += step) values.add(value === 7 ? 0 : value);
      continue;
    }

    for (let value = rangeStart; value <= rangeEnd; value += step) {
      const normalized = isDayOfWeek && value === 7 ? 0 : value;
      if (normalized < min || normalized > max) continue;
      values.add(normalized);
    }
  }

  return values;
}

function cronMatches(expr: string, date: Date) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minuteField, hourField, dayField, monthField, weekField] = fields;
  const minutes = expandCronField(minuteField, 0, 59);
  const hours = expandCronField(hourField, 0, 23);
  const days = expandCronField(dayField, 1, 31);
  const months = expandCronField(monthField, 1, 12);
  const weekdays = expandCronField(weekField, 0, 6, true);

  if (!minutes || !hours || !days || !months || !weekdays) return false;

  return (
    minutes.has(date.getMinutes()) &&
    hours.has(date.getHours()) &&
    days.has(date.getDate()) &&
    months.has(date.getMonth() + 1) &&
    weekdays.has(date.getDay())
  );
}

function getEveryAnchor(job: CronJob, dayStart: number, now: number) {
  const nextRun = job.state?.nextRunAtMs;
  const lastRun = job.state?.lastRunAtMs;
  if (isFiniteNumber(nextRun)) return nextRun;
  if (isFiniteNumber(lastRun)) return lastRun;
  if (isFiniteNumber(job.schedule?.atMs)) return job.schedule.atMs;
  if (job.schedule?.at) {
    const parsed = Date.parse(job.schedule.at);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Math.max(dayStart, now);
}

function getNextRunAt(job: CronJob, now: number) {
  const cachedNextRun = job.state?.nextRunAtMs;
  if (isFiniteNumber(cachedNextRun) && cachedNextRun >= now - MINUTE_MS) {
    return cachedNextRun;
  }

  const scheduleKind = getScheduleKind(job);
  if (!scheduleKind || job.enabled === false) return null;

  if (scheduleKind === 'at') {
    const atMs = isFiniteNumber(job.schedule?.atMs) ? job.schedule?.atMs : Date.parse(job.schedule?.at || '');
    return Number.isFinite(atMs) && atMs > now ? atMs : null;
  }

  if (scheduleKind === 'every') {
    const everyMs = job.schedule?.everyMs;
    if (!isFiniteNumber(everyMs) || everyMs <= 0) return null;
    const anchor = getEveryAnchor(job, startOfDay(now), now);
    let nextRun = anchor;
    while (nextRun <= now) nextRun += everyMs;
    return nextRun;
  }

  const expr = job.schedule?.expr;
  if (!expr) return null;

  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let steps = 0; steps < 8 * 24 * 60; steps += 1) {
    if (cronMatches(expr, cursor)) {
      return cursor.getTime();
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

function getTimelinePoints(job: CronJob, now: number) {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const scheduleKind = getScheduleKind(job);

  if (!scheduleKind || job.enabled === false) return [];

  if (scheduleKind === 'at') {
    const atMs = isFiniteNumber(job.schedule?.atMs) ? job.schedule?.atMs : Date.parse(job.schedule?.at || '');
    if (!Number.isFinite(atMs) || atMs < dayStart || atMs >= dayEnd) return [];
    return [atMs];
  }

  if (scheduleKind === 'every') {
    const everyMs = job.schedule?.everyMs;
    if (!isFiniteNumber(everyMs) || everyMs <= 0) return [];
    const anchor = getEveryAnchor(job, dayStart, now);
    const points: number[] = [];
    let cursor = anchor;

    while (cursor >= dayStart) cursor -= everyMs;
    cursor += everyMs;

    while (cursor < dayEnd) {
      if (cursor >= dayStart) points.push(cursor);
      cursor += everyMs;
    }

    return limitPoints(points);
  }

  const expr = job.schedule?.expr;
  if (!expr) return [];

  const cursor = new Date(dayStart);
  const points: number[] = [];
  while (cursor.getTime() < dayEnd) {
    if (cronMatches(expr, cursor)) {
      points.push(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return limitPoints(points);
}

function getTimelinePosition(value: number, dayStart: number) {
  return ((value - dayStart) / DAY_MS) * 100;
}

export function CronPanel({ onClose }: CronPanelProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>('overview');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState<CronFormState>(DEFAULT_FORM);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [loadingRuns, setLoadingRuns] = useState<Record<string, boolean>>({});
  const [runsByJobId, setRunsByJobId] = useState<Record<string, CronRun[]>>({});
  const [runsError, setRunsError] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  const addEvent = useWorldStore((state) => state.addEvent);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(interval);
  }, []);

  const requestAction = useCallback(async (type: string, params: Record<string, unknown> = {}): Promise<ActionResponse> => {
    const response = await authFetch('/clawcraft/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, params }),
    });
    return response.json();
  }, []);

  const loadJobs = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setLoadError(null);

      try {
        const data = await requestAction('cron.list');
        if (data.ok) {
          setJobs(Array.isArray(data.data?.jobs) ? data.data.jobs : []);
          return;
        }
        const message = data.error || '读取 Cron Jobs 失败';
        setLoadError(message);
        setResult({ ok: false, message });
      } catch (error: any) {
        const message = error.message || '读取 Cron Jobs 失败';
        setLoadError(message);
        setResult({ ok: false, message });
      } finally {
        setLoading(false);
      }
    },
    [requestAction],
  );

  const loadRuns = useCallback(
    async (jobId: string, force = false) => {
      if (!jobId) return;
      if (!force && runsByJobId[jobId]) return;

      setLoadingRuns((current) => ({ ...current, [jobId]: true }));
      setRunsError((current) => {
        const next = { ...current };
        delete next[jobId];
        return next;
      });

      try {
        const data = await requestAction('cron.runs', { jobId, limit: 10 });
        if (data.ok) {
          const runs = Array.isArray(data.data?.runs) ? data.data.runs.slice().reverse() : [];
          setRunsByJobId((current) => ({ ...current, [jobId]: runs }));
          return;
        }

        const message = data.error || '读取运行历史失败';
        setRunsError((current) => ({ ...current, [jobId]: message }));
        setResult({ ok: false, message });
      } catch (error: any) {
        const message = error.message || '读取运行历史失败';
        setRunsError((current) => ({ ...current, [jobId]: message }));
        setResult({ ok: false, message });
      } finally {
        setLoadingRuns((current) => ({ ...current, [jobId]: false }));
      }
    },
    [requestAction, runsByJobId],
  );

  useEffect(() => {
    void loadJobs(true);
  }, [loadJobs]);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((left, right) => {
        const leftTs = getNextRunAt(left, now) || left.state?.lastRunAtMs || 0;
        const rightTs = getNextRunAt(right, now) || right.state?.lastRunAtMs || 0;
        return leftTs - rightTs;
      }),
    [jobs, now],
  );

  const upcomingJobs = useMemo(
    () =>
      sortedJobs
        .map((job) => ({ job, nextRunAt: getNextRunAt(job, now) }))
        .filter((entry) => entry.nextRunAt)
        .slice(0, 4),
    [now, sortedJobs],
  );

  const emitResult = useCallback(
    (ok: boolean, message: string) => {
      setResult({ ok, message });
      addEvent({
        id: `cron-${Date.now()}`,
        type: ok ? 'info' : 'error',
        message,
        ts: Date.now(),
      });
    },
    [addEvent],
  );

  const invalidateRuns = useCallback((jobId: string) => {
    setRunsByJobId((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });
  }, []);

  const executeJobAction = useCallback(
    async (
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
    },
    [emitResult, expandedRuns, invalidateRuns, loadJobs, loadRuns, requestAction],
  );

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
      { text: '⏰ 新任务已建成', color: 0x0ea5e9 },
    );

    if (data?.ok) {
      setForm(DEFAULT_FORM);
      setShowAdvanced(false);
      setShowCreateForm(false);
      setActiveTab('jobs');
    }
  }, [executeJobAction, form]);

  const toggleRuns = useCallback(
    (jobId: string) => {
      const nextExpanded = !expandedRuns[jobId];
      setExpandedRuns((current) => ({ ...current, [jobId]: nextExpanded }));
      if (nextExpanded) {
        void loadRuns(jobId, true);
      }
    },
    [expandedRuns, loadRuns],
  );

  return (
    <div className="w-full rounded-3xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between border-b border-slate-700/40 px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">⏰</span>
            <h2 className="text-base font-semibold text-slate-100">时光钟塔</h2>
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300">
              {jobs.length} 个任务
            </span>
          </div>
          <p className="text-[11px] text-slate-500">查看今日排程、运行历史和即将发生的自动化动作。</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-400 transition-all duration-200 hover:border-slate-500 hover:text-slate-100"
        >
          关闭
        </button>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PanelTab)} className="flex max-h-[60vh] flex-col">
        <div className="border-b border-slate-700/30 px-4 py-3">
          <TabsList className="grid h-10 w-full max-w-[16rem] grid-cols-2 rounded-2xl bg-slate-900/70">
            <TabsTrigger value="overview" className="text-sm transition-all duration-200">
              📊 概览
            </TabsTrigger>
            <TabsTrigger value="jobs" className="text-sm transition-all duration-200">
              📋 任务
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0 flex-1 overflow-y-auto p-4">
          <CronOverview
            jobs={sortedJobs}
            now={now}
            loading={loading}
            loadError={loadError}
            upcomingJobs={upcomingJobs}
            onRetry={() => void loadJobs(true)}
            onCreate={() => {
              setActiveTab('jobs');
              setShowCreateForm(true);
            }}
          />
        </TabsContent>

        <TabsContent value="jobs" className="mt-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <div className="rounded-2xl border border-sky-500/20 bg-slate-900/60 p-3">
              <button
                onClick={() => {
                  setShowCreateForm((current) => !current);
                  setResult(null);
                }}
                className="w-full rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-200 transition-all duration-200 hover:bg-sky-500/20"
              >
                {showCreateForm ? '收起创建表单' : '＋ 添加任务'}
              </button>

              {showCreateForm && (
                <div className="mt-3 space-y-3 rounded-2xl border border-slate-700/60 bg-slate-950/80 p-3">
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
                            className={`rounded-xl border px-3 py-2 text-sm transition-all duration-200 ${
                              form.sessionTarget === target
                                ? 'border-sky-400/50 bg-sky-500/15 text-sky-100'
                                : 'border-slate-700/70 bg-slate-900/70 text-slate-400 hover:border-slate-500 hover:text-slate-200'
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
                          className={`rounded-xl border px-3 py-2 text-sm transition-all duration-200 ${
                            form.scheduleKind === kind
                              ? 'border-sky-400/50 bg-sky-500/15 text-sky-100'
                              : 'border-slate-700/70 bg-slate-900/70 text-slate-400 hover:border-slate-500 hover:text-slate-200'
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
                        placeholder={
                          form.scheduleKind === 'cron'
                            ? '0 7 * * *'
                            : form.scheduleKind === 'every'
                              ? '30m'
                              : '2026-03-15T07:00:00+08:00'
                        }
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
                      placeholder={
                        form.sessionTarget === 'main'
                          ? '[System Event] It is 8:00 AM...'
                          : 'Write a summary and deliver it to Dad...'
                      }
                    />
                  </Field>

                  <button
                    onClick={() => setShowAdvanced((current) => !current)}
                    className="text-xs font-medium text-slate-400 transition-all duration-200 hover:text-slate-200"
                  >
                    {showAdvanced ? '▾ 收起高级选项' : '▸ 高级选项'}
                  </button>

                  {showAdvanced && (
                    <div className="grid gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/50 p-3 sm:grid-cols-2">
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
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-sky-400"
                        />
                        发送结果到聊天
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={form.lightContext}
                          onChange={(event) => setForm((current) => ({ ...current, lightContext: event.target.checked }))}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-sky-400"
                          disabled={form.sessionTarget === 'main'}
                        />
                        轻量上下文
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={form.deleteAfterRun}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, deleteAfterRun: event.target.checked }))
                          }
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-sky-400"
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
                      className="flex-1 rounded-xl border border-slate-700/70 px-4 py-2 text-sm text-slate-400 transition-all duration-200 hover:border-slate-500 hover:text-slate-100"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={actionKey === 'cron:create'}
                      className="flex-1 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-sky-500 disabled:opacity-50"
                    >
                      {actionKey === 'cron:create' ? '创建中...' : '创建'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {loading ? (
              <LoadingCard label="正在校准钟塔..." />
            ) : loadError ? (
              <ErrorCard
                message={loadError}
                actionLabel="点击重试"
                onAction={() => void loadJobs(true)}
              />
            ) : sortedJobs.length === 0 ? (
              <EmptyCard
                icon="⏰"
                title="时光钟塔尚未设定任务"
                description="添加第一个 Cron Job，让王国自动运转。"
                actionLabel="创建任务"
                onAction={() => setShowCreateForm(true)}
              />
            ) : (
              sortedJobs.map((job, index) => {
                const jobId = getJobId(job);
                const status = getJobStatus(job);
                const runs = runsByJobId[jobId] || [];
                const isExpanded = Boolean(expandedRuns[jobId]);
                const nextRunAt = getNextRunAt(job, now);
                const countdownLabel = formatCountdown(nextRunAt, now);

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
                        <p className="mt-1 text-[11px] text-slate-500">⏱ {formatSchedule(job)}</p>
                        <p className="mt-1 text-[11px] text-slate-500">🎯 {describeDelivery(job)}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">下次运行</div>
                        <div className="text-sm font-medium text-slate-200">{countdownLabel}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{formatDateTime(nextRunAt || undefined)}</div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 rounded-2xl border border-slate-800/70 bg-slate-950/50 p-3 text-xs text-slate-400">
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
                      {job.state?.lastError ? (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-300">
                          {job.state.lastError}
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${TIMELINE_COLORS[index % TIMELINE_COLORS.length].split(' ')[0].replace('text-', 'bg-')}`} />
                        <span className="text-[11px] text-slate-500">概览时间线中的轨道颜色</span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() =>
                          void executeJobAction(
                            'cron.run',
                            { jobId },
                            `⏯ 已运行 ${getJobName(job)}`,
                            `cron:run:${jobId}`,
                            jobId,
                            { text: '▶ 手动运行', color: 0x22c55e },
                          )
                        }
                        disabled={actionKey === `cron:run:${jobId}`}
                        className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-all duration-200 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {actionKey === `cron:run:${jobId}` ? '运行中...' : '▶ 运行'}
                      </button>
                      <button
                        onClick={() =>
                          void executeJobAction(
                            'cron.toggle',
                            { jobId, enabled: job.enabled === false },
                            `⏰ ${getJobName(job)} 已${job.enabled === false ? '启用' : '停用'}`,
                            `cron:toggle:${jobId}`,
                            jobId,
                            {
                              text: job.enabled === false ? '✅ 已启用' : '⏸ 已停用',
                              color: job.enabled === false ? 0x22c55e : 0xf59e0b,
                            },
                          )
                        }
                        disabled={actionKey === `cron:toggle:${jobId}`}
                        className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-all duration-200 hover:bg-amber-500/20 disabled:opacity-50"
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
                        className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-all duration-200 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {actionKey === `cron:remove:${jobId}` ? '删除中...' : '🗑 删除'}
                      </button>
                      <button
                        onClick={() => toggleRuns(jobId)}
                        className="rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all duration-200 hover:border-slate-500 hover:bg-slate-800"
                      >
                        {isExpanded ? '📜 收起历史' : '📜 执行历史'}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-100">执行历史</h3>
                            <p className="text-[11px] text-slate-500">最近 10 次运行，用于快速判断任务是否稳定。</p>
                          </div>
                          <button
                            onClick={() => void loadRuns(jobId, true)}
                            className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 transition-all duration-200 hover:border-slate-500 hover:text-slate-100"
                          >
                            刷新历史
                          </button>
                        </div>

                        {loadingRuns[jobId] ? (
                          <LoadingCard label="正在回溯运行记录..." compact />
                        ) : runsError[jobId] ? (
                          <ErrorCard
                            message={runsError[jobId]}
                            actionLabel="点击重试"
                            onAction={() => void loadRuns(jobId, true)}
                            compact
                          />
                        ) : runs.length === 0 ? (
                          <EmptyCard
                            icon="🗂️"
                            title="暂无历史数据"
                            description="当前没有可展示的执行记录，可能需要等待 Cron 网关写入下一次运行。"
                            actionLabel="立即运行"
                            onAction={() =>
                              void executeJobAction(
                                'cron.run',
                                { jobId },
                                `⏯ 已运行 ${getJobName(job)}`,
                                `cron:run:${jobId}`,
                                jobId,
                              )
                            }
                            compact
                          />
                        ) : (
                          runs.map((run, runIndex) => (
                            <div
                              key={`${jobId}-${run.ts || run.runAtMs || runIndex}`}
                              className="rounded-2xl border border-slate-800/70 bg-slate-900/50 p-3"
                            >
                              <div className="flex items-center justify-between gap-3 text-xs">
                                <span className={`rounded-full border px-2 py-0.5 font-medium ${getStatusClass(run.status || 'idle')}`}>
                                  {run.status || 'unknown'}
                                </span>
                                <span className="text-slate-500">{formatDateTimeWithSeconds(run.runAtMs || run.ts)}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                                <span>耗时 {formatDuration(run.durationMs)}</span>
                                {run.model ? <span>模型 {run.model}</span> : null}
                                {run.provider ? <span>提供方 {run.provider}</span> : null}
                                {run.usage?.total_tokens ? <span>Tokens {run.usage.total_tokens}</span> : null}
                              </div>
                              {run.error ? <p className="mt-2 text-[11px] text-red-300">{run.error}</p> : null}
                              {run.summary ? <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">{run.summary}</p> : null}
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
        </TabsContent>
      </Tabs>

      {result ? (
        <div
          className={`mx-4 mb-4 rounded-2xl border px-4 py-2 text-xs ${
            result.ok
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/20 bg-red-500/10 text-red-300'
          }`}
        >
          {result.ok ? '✅' : '❌'} {result.message}
        </div>
      ) : null}
    </div>
  );
}

function CronOverview({
  jobs,
  now,
  loading,
  loadError,
  upcomingJobs,
  onRetry,
  onCreate,
}: {
  jobs: CronJob[];
  now: number;
  loading: boolean;
  loadError: string | null;
  upcomingJobs: Array<{ job: CronJob; nextRunAt: number | null }>;
  onRetry: () => void;
  onCreate: () => void;
}) {
  const activeCount = jobs.filter((job) => job.enabled !== false).length;
  const errorCount = jobs.filter((job) => ['error', 'failed'].includes(getJobStatus(job))).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <OverviewStat label="今日任务" value={jobs.length} sublabel="总排程数量" />
        <OverviewStat label="已启用" value={activeCount} sublabel="当前会继续触发" accent="sky" />
        <OverviewStat label="异常" value={errorCount} sublabel="需要检查的任务" accent={errorCount > 0 ? 'red' : 'emerald'} />
      </div>

      {loading ? (
        <LoadingCard label="正在绘制今日时间线..." />
      ) : loadError ? (
        <ErrorCard message={loadError} actionLabel="点击重试" onAction={onRetry} />
      ) : jobs.length === 0 ? (
        <EmptyCard
          icon="📊"
          title="今天还没有时间线"
          description="先创建一个 Cron Job，概览会在这里展示全天排程。"
          actionLabel="创建任务"
          onAction={onCreate}
        />
      ) : (
        <>
          <div className="rounded-3xl border border-slate-700/40 bg-slate-900/50 p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-100">24h 时间线</h3>
              <p className="text-[11px] text-slate-500">实心点表示已过执行时刻，空心点表示未来计划，红线为当前时间。</p>
            </div>
            <CronTimeline jobs={jobs} now={now} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
              <h3 className="text-sm font-semibold text-slate-100">即将发生</h3>
              <p className="text-[11px] text-slate-500">根据当前 schedule 计算的下一批任务。</p>
              <div className="mt-3 space-y-2">
                {upcomingJobs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700/50 bg-slate-950/50 px-3 py-4 text-center text-sm text-slate-500">
                    暂无可计算的下一次运行时间。
                  </div>
                ) : (
                  upcomingJobs.map(({ job, nextRunAt }) => (
                    <div key={getJobId(job)} className="rounded-2xl border border-slate-800/70 bg-slate-950/60 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium text-slate-100">{getJobName(job)}</span>
                        <span className="text-xs text-sky-300">{formatCountdown(nextRunAt, now)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{formatDateTime(nextRunAt || undefined)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
              <h3 className="text-sm font-semibold text-slate-100">概览提示</h3>
              <p className="text-[11px] text-slate-500">如果时间线为空，通常意味着任务禁用、一次性任务已过期，或 schedule 无法在前端推导。</p>
              <div className="mt-3 space-y-2 text-[11px] text-slate-400">
                <div className="rounded-xl bg-slate-950/60 px-3 py-2">优先检查 `state.nextRunAtMs` 是否持续更新。</div>
                <div className="rounded-xl bg-slate-950/60 px-3 py-2">`every` / 简单 cron / 一次性任务会直接显示在时间线中。</div>
                <div className="rounded-xl bg-slate-950/60 px-3 py-2">更复杂的 cron 表达式会尽力推导，但仍以后端调度为准。</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CronTimeline({ jobs, now }: { jobs: CronJob[]; now: number }) {
  const dayStart = startOfDay(now);
  const nowPosition = getTimelinePosition(now, dayStart);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-700/40 bg-slate-950/70 p-4">
      <div className="relative h-8">
        {Array.from({ length: 25 }, (_, index) => (
          <div
            key={index}
            className="absolute top-0 bottom-0"
            style={{ left: `${(index / 24) * 100}%` }}
          >
            <div className="h-full w-px bg-slate-800/80" />
            {index < 24 ? (
              <span className="absolute left-1 top-0 text-[9px] text-slate-600">{String(index).padStart(2, '0')}</span>
            ) : null}
          </div>
        ))}
        <div className="absolute top-0 bottom-0 w-px bg-red-500/70" style={{ left: `${nowPosition}%` }} />
      </div>

      <div className="mt-2 space-y-3">
        {jobs.map((job, laneIndex) => (
          <CronJobLane key={getJobId(job)} job={job} laneIndex={laneIndex} now={now} dayStart={dayStart} />
        ))}
      </div>
    </div>
  );
}

function CronJobLane({
  job,
  laneIndex,
  now,
  dayStart,
}: {
  job: CronJob;
  laneIndex: number;
  now: number;
  dayStart: number;
}) {
  const colorClass = TIMELINE_COLORS[laneIndex % TIMELINE_COLORS.length];
  const points = getTimelinePoints(job, now);

  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_1fr] sm:items-center">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-slate-200">{getJobName(job)}</div>
        <div className="text-[11px] text-slate-500">{formatSchedule(job)}</div>
      </div>
      <div className={`relative h-8 rounded-2xl border ${colorClass} px-2`}>
        <div className="absolute inset-y-3 left-0 right-0 border-t border-dashed border-current/30" />
        {points.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-600">今日无可视化节点</div>
        ) : (
          points.map((point) => {
            const isPast = point <= now;
            return (
              <div
                key={`${getJobId(job)}-${point}`}
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                  isPast ? 'bg-current border-current shadow-[0_0_10px_rgba(14,165,233,0.18)]' : 'bg-slate-950 border-current'
                }`}
                style={{ left: `${getTimelinePosition(point, dayStart)}%` }}
                title={`${getJobName(job)} · ${formatDateTimeWithSeconds(point)}`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function OverviewStat({
  label,
  value,
  sublabel,
  accent = 'slate',
}: {
  label: string;
  value: number;
  sublabel: string;
  accent?: 'slate' | 'sky' | 'emerald' | 'red';
}) {
  const accentClass =
    accent === 'sky'
      ? 'border-sky-500/20 bg-sky-500/10 text-sky-300'
      : accent === 'emerald'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
        : accent === 'red'
          ? 'border-red-500/20 bg-red-500/10 text-red-300'
          : 'border-slate-700/40 bg-slate-900/50 text-slate-100';

  return (
    <div className={`rounded-2xl border p-4 ${accentClass}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{sublabel}</div>
    </div>
  );
}

function LoadingCard({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div
      className={`rounded-2xl border border-slate-700/40 bg-slate-900/50 text-center text-slate-400 ${
        compact ? 'px-3 py-5 text-sm' : 'px-4 py-10 text-base'
      }`}
    >
      <div className="animate-pulse">{label}</div>
    </div>
  );
}

function EmptyCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-slate-700/50 bg-slate-900/30 text-center ${
        compact ? 'px-3 py-5' : 'px-4 py-8'
      }`}
    >
      <p className={compact ? 'text-2xl' : 'text-3xl'}>{icon}</p>
      <p className="mt-2 text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-1 text-[11px] text-slate-500">{description}</p>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="mt-4 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-sky-500"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function ErrorCard({
  message,
  actionLabel,
  onAction,
  compact = false,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-red-500/20 bg-red-500/10 text-center ${
        compact ? 'px-3 py-5' : 'px-4 py-8'
      }`}
    >
      <p className={compact ? 'text-xl' : 'text-3xl'}>⚠️</p>
      <p className="mt-2 text-sm font-medium text-red-200">加载失败</p>
      <p className="mt-1 text-[11px] text-red-200/80">{message}</p>
      <button
        onClick={onAction}
        className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-100 transition-all duration-200 hover:bg-red-500/20"
      >
        {actionLabel}
      </button>
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

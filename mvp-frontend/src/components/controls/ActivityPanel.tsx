import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileEditor } from '@/components/controls/FileEditor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ActivityEvent, ActivityStats, WorkspaceFileEntry } from '@/store/types';
import { useWorldStore } from '@/store/world-store';

interface ActivityPanelProps {
  open: boolean;
  onClose: () => void;
}

type ActivityTab = 'timeline' | 'artifacts' | 'stats';

const EVENT_ICONS: Record<ActivityEvent['type'], string> = {
  message: '💬',
  tool_call: '🔧',
  file_change: '📝',
  subagent: '🤖',
  cron: '⏰',
  error: '❌',
};

const EVENT_COLORS: Record<ActivityEvent['type'], string> = {
  message: 'text-sky-300',
  tool_call: 'text-amber-300',
  file_change: 'text-emerald-300',
  subagent: 'text-violet-300',
  cron: 'text-indigo-300',
  error: 'text-red-300',
};

function formatDateTime(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatFileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function ActivityPanel({ open, onClose }: ActivityPanelProps) {
  const agents = useWorldStore((state) => state.agents);
  const sessions = useWorldStore((state) => state.sessions);
  const [activeTab, setActiveTab] = useState<ActivityTab>('timeline');
  const [agentFilter, setAgentFilter] = useState('all');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editorTarget, setEditorTarget] = useState<{ agentId: string; path: string } | null>(null);

  const loadActivity = useCallback(async (showSpinner = true) => {
    const controller = new AbortController();
    const query = agentFilter === 'all' ? '' : `?agentId=${encodeURIComponent(agentFilter)}&limit=60`;
    const fileQuery = agentFilter === 'all' ? '?limit=32' : `?agentId=${encodeURIComponent(agentFilter)}&limit=32`;

    if (showSpinner) {
      setLoading(true);
    }
    setError(null);

    try {
      const [activityResponse, filesResponse] = await Promise.all([
        fetch(`/clawcraft/activity${query}`, { signal: controller.signal }),
        fetch(`/clawcraft/workspace-files${fileQuery}`, { signal: controller.signal }),
      ]);

      if (!activityResponse.ok) {
        throw new Error(`活动接口返回 ${activityResponse.status}`);
      }
      if (!filesResponse.ok) {
        throw new Error(`文件接口返回 ${filesResponse.status}`);
      }

      const [activityPayload, filesPayload] = await Promise.all([activityResponse.json(), filesResponse.json()]);
      setEvents(Array.isArray(activityPayload.events) ? activityPayload.events : []);
      setStats(activityPayload.stats ?? null);
      setFiles(Array.isArray(filesPayload.files) ? filesPayload.files : []);
      setLastUpdatedAt(Date.now());
      return () => controller.abort();
    } catch (fetchError) {
      if (controller.signal.aborted) {
        return () => controller.abort();
      }

      const message = fetchError instanceof Error ? fetchError.message : '加载活动数据失败';
      setEvents([]);
      setFiles([]);
      setStats(null);
      setError(message);
      return () => controller.abort();
    } finally {
      setLoading(false);
    }
  }, [agentFilter]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    let cleanup: (() => void) | undefined;

    void loadActivity(true).then((dispose) => {
      if (!active) {
        dispose?.();
        return;
      }

      cleanup = dispose;
    });

    const interval = window.setInterval(() => {
      void loadActivity(false);
    }, 30_000);

    return () => {
      active = false;
      cleanup?.();
      window.clearInterval(interval);
    };
  }, [loadActivity, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setExpanded({});
  }, [agentFilter, open]);

  const groupedFiles = useMemo(
    () => ({
      code: files.filter((file) => file.type === 'code'),
      doc: files.filter((file) => file.type === 'doc'),
      config: files.filter((file) => file.type === 'config'),
      other: files.filter((file) => file.type === 'other'),
    }),
    [files],
  );

  const activeSessions = Object.values(sessions).filter((session) => session.status !== 'ended').length;

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="pointer-events-auto absolute inset-x-4 bottom-4 top-20 z-30">
        <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-4">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
                  <span>📊</span>
                  <span>活动面板</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">时间线、产出物和今日统计都在这里。</p>
              </div>
              <span className="rounded-full bg-slate-800/80 px-3 py-1 text-[11px] text-slate-400">
                活跃 Session {activeSessions}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={agentFilter}
                onChange={(event) => setAgentFilter(event.target.value)}
                className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none transition-all duration-200"
              >
                <option value="all">全部 Agent</option>
                {Object.keys(agents).sort().map((agentId) => (
                  <option key={agentId} value={agentId}>
                    {agentId}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadActivity(true)}
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-300 transition-all duration-200 hover:text-slate-100"
              >
                🔄 刷新
              </button>
              <button
                onClick={onClose}
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-300 transition-all duration-200 hover:text-slate-100"
              >
                关闭
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-slate-700/20 px-5 py-2 text-[11px] text-slate-500">
            <span>最近更新: {lastUpdatedAt ? formatTime(lastUpdatedAt) : '尚未加载'}</span>
            <span>{loading ? '同步中...' : '打开面板后每 30 秒自动刷新'}</span>
          </div>

          <div className="flex-1 overflow-hidden px-5 py-4">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ActivityTab)} className="flex h-full flex-col">
              <TabsList className="mb-4 h-10 w-fit bg-slate-900/70">
                <TabsTrigger value="timeline" className="px-4 text-sm">⏱️ 时间线</TabsTrigger>
                <TabsTrigger value="artifacts" className="px-4 text-sm">📦 产出物</TabsTrigger>
                <TabsTrigger value="stats" className="px-4 text-sm">📊 统计</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline" className="mt-0 flex-1 overflow-y-auto">
                {error ? (
                  <EmptyState
                    icon="⚠️"
                    title="加载失败，点击重试"
                    description={error}
                    actionLabel="重新加载"
                    onAction={() => void loadActivity(true)}
                    tone="error"
                  />
                ) : loading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }, (_, index) => (
                      <div key={index} className="h-20 animate-pulse rounded-2xl border border-slate-800/70 bg-slate-900/50" />
                    ))}
                  </div>
                ) : events.length === 0 ? (
                  <EmptyState
                    icon="🫥"
                    title="暂无活动记录"
                    description="等待 Agent 触发 LLM、工具、文件或子任务事件。"
                    actionLabel="重新检查"
                    onAction={() => void loadActivity(true)}
                  />
                ) : (
                  <div className="space-y-3">
                    {events.map((event) => {
                      const isExpanded = Boolean(expanded[event.id]);
                      return (
                        <button
                          key={event.id}
                          onClick={() => setExpanded((current) => ({ ...current, [event.id]: !current[event.id] }))}
                          className="w-full rounded-2xl border border-slate-700/40 bg-slate-900/50 px-4 py-3 text-left transition-all duration-200 hover:border-slate-500/60"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className={`flex items-center gap-2 text-sm ${EVENT_COLORS[event.type]}`}>
                                <span>{EVENT_ICONS[event.type]}</span>
                                <span className="font-medium">{event.summary}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                                <span>{formatDateTime(event.timestamp)}</span>
                                <span>{event.agentId}</span>
                                {event.sessionKey ? <span>{event.sessionKey.slice(0, 20)}</span> : null}
                              </div>
                            </div>
                            <span className="text-xs text-slate-500">{isExpanded ? '收起' : '展开'}</span>
                          </div>
                          {isExpanded && event.detail ? (
                            <div className="mt-3 rounded-2xl border border-slate-800/80 bg-slate-950/70 px-3 py-3 text-sm leading-6 text-slate-300">
                              <pre className="whitespace-pre-wrap break-words font-sans">{event.detail}</pre>
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="artifacts" className="mt-0 flex-1 overflow-y-auto">
                <div className="grid gap-4 lg:grid-cols-2">
                  {([
                    ['code', '代码'],
                    ['doc', '文档'],
                    ['config', '配置'],
                    ['other', '其他'],
                  ] as const).map(([type, label]) => (
                    <div key={type} className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-base font-semibold text-slate-100">{label}</h3>
                        <span className="text-[11px] text-slate-500">{groupedFiles[type].length} 个</span>
                      </div>

                      <div className="space-y-2">
                        {loading ? (
                          <div className="h-20 animate-pulse rounded-xl border border-slate-800/70 bg-slate-950/60" />
                        ) : groupedFiles[type].length === 0 ? (
                          <EmptyState
                            icon="📭"
                            title={`暂无${label}`}
                            description={`最近 24 小时内没有新的${label}变更。`}
                            compact
                          />
                        ) : (
                          groupedFiles[type].map((file) => (
                            <button
                              key={`${file.agentId}:${file.path}`}
                              onClick={() => setEditorTarget({ agentId: file.agentId, path: file.path })}
                              className="w-full rounded-2xl border border-slate-800/70 bg-slate-950/60 px-3 py-3 text-left transition-all duration-200 hover:border-slate-500/60"
                            >
                              <div className="truncate text-sm font-medium text-slate-100">{file.name}</div>
                              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                                <span>{file.agentId}</span>
                                <span>{formatFileSize(file.size)}</span>
                                <span>{formatDateTime(file.mtime)}</span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="stats" className="mt-0 flex-1 overflow-y-auto">
                {error ? (
                  <EmptyState
                    icon="⚠️"
                    title="统计暂时不可用"
                    description={error}
                    actionLabel="重试"
                    onAction={() => void loadActivity(true)}
                    tone="error"
                  />
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <StatCard label="今日 LLM 调用" value={stats?.llmCallsToday ?? 0} />
                      <StatCard label="今日 Tokens" value={stats?.tokensToday ?? 0} />
                      <StatCard label="今日工具调用" value={stats?.toolCallsToday ?? 0} />
                      <StatCard label="今日文件变更" value={stats?.fileChangesToday ?? 0} />
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
                        <h3 className="text-base font-semibold text-slate-100">Top 5 工具</h3>
                        <div className="mt-3 space-y-2">
                          {(stats?.toolUsageTop ?? []).length === 0 ? (
                            <EmptyState
                              icon="🧰"
                              title="暂无工具数据"
                              description="工具调用后这里会显示最高频的使用情况。"
                              compact
                            />
                          ) : (
                            (stats?.toolUsageTop ?? []).map((entry) => (
                              <div key={entry.name} className="flex items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2 text-sm">
                                <span className="text-slate-300">{entry.name}</span>
                                <span className="text-slate-500">{entry.count}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
                        <h3 className="text-base font-semibold text-slate-100">会话</h3>
                        <div className="mt-3 space-y-2">
                          <StatLine label="活跃 Session" value={stats?.activeSessions ?? activeSessions} />
                          <StatLine label="已抓取活动" value={events.length} />
                          <StatLine label="最近文件" value={files.length} />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {editorTarget ? (
        <FileEditor
          agentId={editorTarget.agentId}
          initialFile={editorTarget.path}
          onClose={() => setEditorTarget(null)}
        />
      ) : null}
    </>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  tone = 'default',
  compact = false,
}: {
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'error';
  compact?: boolean;
}) {
  const borderClass = tone === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-dashed border-slate-700/60 bg-slate-900/30';
  const titleClass = tone === 'error' ? 'text-red-200' : 'text-slate-300';
  const descriptionClass = tone === 'error' ? 'text-red-300/70' : 'text-slate-500';
  const actionClass =
    tone === 'error'
      ? 'border-red-500/30 bg-red-500/10 text-red-100 hover:bg-red-500/20'
      : 'border-sky-500/30 bg-sky-600/10 text-sky-200 hover:bg-sky-600/20';

  return (
    <div className={`rounded-2xl ${borderClass} ${compact ? 'px-3 py-4' : 'px-4 py-8'} text-center`}>
      <p className={compact ? 'text-xl' : 'text-3xl'}>{icon}</p>
      <p className={`mt-2 text-sm ${titleClass}`}>{title}</p>
      <p className={`mt-1 text-[11px] ${descriptionClass}`}>{description}</p>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className={`mt-4 rounded-xl border px-3 py-2 text-sm transition-all duration-200 ${actionClass}`}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-100">{value}</span>
    </div>
  );
}

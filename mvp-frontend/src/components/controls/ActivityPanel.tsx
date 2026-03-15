import { useEffect, useMemo, useState } from 'react';
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editorTarget, setEditorTarget] = useState<{ agentId: string; path: string; name: string } | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    const query = agentFilter === 'all' ? '' : `?agentId=${encodeURIComponent(agentFilter)}&limit=60`;
    const fileQuery = agentFilter === 'all' ? '?limit=32' : `?agentId=${encodeURIComponent(agentFilter)}&limit=32`;

    setLoading(true);
    Promise.all([
      fetch(`/clawcraft/activity${query}`, { signal: controller.signal }).then((response) => response.json()),
      fetch(`/clawcraft/workspace-files${fileQuery}`, { signal: controller.signal }).then((response) => response.json()),
    ])
      .then(([activityPayload, filesPayload]) => {
        setEvents(Array.isArray(activityPayload.events) ? activityPayload.events : []);
        setStats(activityPayload.stats ?? null);
        setFiles(Array.isArray(filesPayload.files) ? filesPayload.files : []);
      })
      .catch(() => {
        setEvents([]);
        setFiles([]);
        setStats(null);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [agentFilter, open]);

  const groupedFiles = useMemo(() => {
    return {
      code: files.filter((file) => file.type === 'code'),
      doc: files.filter((file) => file.type === 'doc'),
      config: files.filter((file) => file.type === 'config'),
      other: files.filter((file) => file.type === 'other'),
    };
  }, [files]);

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
                <p className="mt-1 text-xs text-slate-500">时间线、产出物和今日统计都在这里。</p>
              </div>
              <span className="rounded-full bg-slate-800/80 px-3 py-1 text-[11px] text-slate-400">
                活跃 Session {activeSessions}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={agentFilter}
                onChange={(event) => setAgentFilter(event.target.value)}
                className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                <option value="all">全部 Agent</option>
                {Object.keys(agents).sort().map((agentId) => (
                  <option key={agentId} value={agentId}>
                    {agentId}
                  </option>
                ))}
              </select>
              <button
                onClick={onClose}
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-300 transition-colors hover:text-slate-100"
              >
                关闭
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden px-5 py-4">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ActivityTab)} className="flex h-full flex-col">
              <TabsList className="mb-4 h-10 w-fit bg-slate-900/70">
                <TabsTrigger value="timeline" className="px-4 text-sm">⏱️ 时间线</TabsTrigger>
                <TabsTrigger value="artifacts" className="px-4 text-sm">📦 产出物</TabsTrigger>
                <TabsTrigger value="stats" className="px-4 text-sm">📊 统计</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline" className="mt-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
                ) : events.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30 px-4 py-8 text-center text-slate-500">
                    暂无活动记录
                  </div>
                ) : (
                  <div className="space-y-3">
                    {events.map((event) => {
                      const isExpanded = Boolean(expanded[event.id]);
                      return (
                        <button
                          key={event.id}
                          onClick={() => setExpanded((current) => ({ ...current, [event.id]: !current[event.id] }))}
                          className="w-full rounded-2xl border border-slate-700/40 bg-slate-900/50 px-4 py-3 text-left transition-colors hover:border-slate-500/60"
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
                        <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
                        <span className="text-xs text-slate-500">{groupedFiles[type].length} 个</span>
                      </div>

                      <div className="space-y-2">
                        {groupedFiles[type].length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-700/50 px-3 py-4 text-center text-sm text-slate-500">
                            暂无文件
                          </div>
                        ) : (
                          groupedFiles[type].map((file) => (
                            <button
                              key={`${file.agentId}:${file.path}`}
                              onClick={() => setEditorTarget({ agentId: file.agentId, path: file.path, name: file.name })}
                              className="w-full rounded-2xl border border-slate-800/70 bg-slate-950/60 px-3 py-3 text-left transition-colors hover:border-slate-500/60"
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
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="今日 LLM 调用" value={stats?.llmCallsToday ?? 0} />
                  <StatCard label="今日 Tokens" value={stats?.tokensToday ?? 0} />
                  <StatCard label="今日工具调用" value={stats?.toolCallsToday ?? 0} />
                  <StatCard label="今日文件变更" value={stats?.fileChangesToday ?? 0} />
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
                    <h3 className="text-sm font-semibold text-slate-100">Top 5 工具</h3>
                    <div className="mt-3 space-y-2">
                      {(stats?.toolUsageTop ?? []).length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-700/50 px-3 py-4 text-center text-sm text-slate-500">
                          暂无工具数据
                        </div>
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
                    <h3 className="text-sm font-semibold text-slate-100">会话</h3>
                    <div className="mt-3 space-y-2">
                      <StatLine label="活跃 Session" value={stats?.activeSessions ?? activeSessions} />
                      <StatLine label="已抓取活动" value={events.length} />
                      <StatLine label="最近文件" value={files.length} />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {editorTarget ? (
        <FileEditor
          agentId={editorTarget.agentId}
          initialFile={editorTarget.name}
          onClose={() => setEditorTarget(null)}
        />
      ) : null}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
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

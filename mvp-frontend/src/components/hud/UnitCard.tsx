import { useWorldStore } from '@/store/world-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatPanel } from './ChatPanel';
import type { UnitCardTab } from '@/store/types';

const STATUS_LABELS: Record<string, string> = {
  idle: '💤 待机',
  thinking: '💭 思考中',
  tooling: '🔧 工具调用',
  responding: '✍️ 回复中',
  blocked: '🚫 阻塞',
  ended: '⏹️ 已结束',
  online: '🟢 在线',
  offline: '🔴 离线',
  busy: '🟡 繁忙',
  running: '🟢 运行中',
  stopping: '🟡 停止中',
  unknown: '❓ 未知',
};

const STATUS_BG: Record<string, string> = {
  idle: 'bg-slate-700/60',
  thinking: 'bg-sky-600/60',
  tooling: 'bg-amber-600/60',
  responding: 'bg-emerald-600/60',
  blocked: 'bg-red-600/60',
  ended: 'bg-slate-800/60',
  online: 'bg-emerald-600/60',
  offline: 'bg-red-600/60',
  running: 'bg-emerald-600/60',
};

export function UnitCard() {
  const selectedEntityId = useWorldStore((s) => s.selectedEntityId);
  const selectedEntityType = useWorldStore((s) => s.selectedEntityType);
  const unitCardTab = useWorldStore((s) => s.unitCardTab);
  const setUnitCardTab = useWorldStore((s) => s.setUnitCardTab);
  const clearSelection = useWorldStore((s) => s.clearSelection);
  const agents = useWorldStore((s) => s.agents);
  const sessions = useWorldStore((s) => s.sessions);
  const gatewayStatus = useWorldStore((s) => s.gatewayStatus);
  const developerMode = useWorldStore((s) => s.developerMode);
  const recentEvents = useWorldStore((s) => s.recentEvents);

  if (!selectedEntityId || !selectedEntityType) return null;

  let title = '';
  let subtitle = '';
  let status = '';
  let statusKey = '';
  let overviewContent: React.ReactNode = null;
  let timelineEvents = recentEvents;

  if (selectedEntityType === 'gateway') {
    title = '🏰 Gateway';
    subtitle = '中央王城';
    status = STATUS_LABELS[gatewayStatus] ?? gatewayStatus;
    statusKey = gatewayStatus;
    overviewContent = (
      <div className="space-y-1.5 text-xs text-slate-300">
        <InfoRow label="Agent" value={`${Object.keys(agents).length} 领主`} />
        <InfoRow label="Session" value={`${Object.values(sessions).filter((s) => s.status !== 'ended').length} 活跃`} />
      </div>
    );
  } else if (selectedEntityType === 'agent') {
    const agent = agents[selectedEntityId];
    if (!agent) return null;
    title = `🏛️ ${agent.name}`;
    subtitle = '领主大厅';
    status = STATUS_LABELS[agent.status] ?? agent.status;
    statusKey = agent.status;
    const agentSessions = agent.sessionKeys.map((k) => sessions[k]).filter(Boolean);
    timelineEvents = recentEvents.filter((e) => e.agentId === selectedEntityId);
    overviewContent = (
      <div className="space-y-1.5 text-xs text-slate-300">
        <InfoRow label="模型" value={agent.model} mono />
        <InfoRow label="探险者" value={`${agentSessions.length} 个`} />
        <InfoRow label="工具" value={`${agent.toolNames.length} 个`} />
        <InfoRow label="技能" value={agent.skillIds.join(', ') || '无'} />
        {agent.soulSummary && <p className="mt-2 italic text-slate-500 text-[11px]">"{agent.soulSummary}"</p>}
        {developerMode && <InfoRow label="ID" value={agent.agentId} mono />}
      </div>
    );
  } else if (selectedEntityType === 'session') {
    const session = sessions[selectedEntityId];
    if (!session) return null;
    const agent = agents[session.agentId];
    title = `⚔️ 探险者`;
    subtitle = agent?.name ?? session.agentId;
    status = STATUS_LABELS[session.status] ?? session.status;
    statusKey = session.status;
    timelineEvents = recentEvents.filter((e) => e.sessionKey === selectedEntityId);
    overviewContent = (
      <div className="space-y-1.5 text-xs text-slate-300">
        <InfoRow label="归属" value={agent?.name ?? session.agentId} />
        {session.currentTool && <InfoRow label="工具" value={`${session.currentTool} (${session.currentToolCategory})`} highlight />}
        <div className="flex gap-4 pt-1">
          <StatBox label="运行" value={session.runCount} />
          <StatBox label="工具" value={session.toolCallCount} />
          <StatBox label="错误" value={session.errorCount} error={session.errorCount > 0} />
        </div>
        {session.lastAssistantPreview && (
          <div className="mt-2 rounded-lg bg-slate-800/60 p-2 text-[11px] text-slate-400 leading-relaxed">
            {session.lastAssistantPreview.slice(0, 120)}{session.lastAssistantPreview.length > 120 ? '...' : ''}
          </div>
        )}
        {developerMode && <InfoRow label="Key" value={session.sessionKey} mono />}
      </div>
    );
  } else if (selectedEntityType === 'building') {
    const building = useWorldStore.getState().buildings.find((b) => b.id === selectedEntityId);
    if (!building) return null;
    title = `${building.icon} ${building.name}`;
    subtitle = `${building.type} 设施`;
    status = `${building.count} 个`;
    statusKey = building.count > 0 ? 'online' : 'unknown';
    overviewContent = (
      <div className="space-y-1.5 text-xs text-slate-300">
        <InfoRow label="类型" value={building.type} />
        <InfoRow label="数量" value={`${building.count}`} />
        {building.items.length > 0 && (
          <div className="mt-2 space-y-1">
            {building.items.slice(0, 8).map((item, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-slate-800/50 px-2 py-0.5">
                <span className="font-mono text-[11px] text-slate-200">{item.name}</span>
                {item.detail && <span className="text-[10px] text-slate-500">{item.detail}</span>}
                {item.status && <span className={`text-[10px] ${item.status === 'connected' || item.status === 'active' ? 'text-emerald-400' : 'text-slate-500'}`}>{item.status}</span>}
              </div>
            ))}
            {building.items.length > 8 && <p className="text-[10px] text-slate-500">+{building.items.length - 8} more...</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-950/85 shadow-2xl backdrop-blur-md">
      {/* Header — RTS unit card style */}
      <div className="flex items-center justify-between border-b border-slate-700/40 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100">{title}</h3>
            <p className="text-[11px] text-slate-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium text-white ${STATUS_BG[statusKey] ?? 'bg-slate-700/60'}`}>
            {status}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); clearSelection(); }}
            className="text-slate-600 hover:text-slate-300 transition-colors text-sm leading-none"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-3 py-2">
        <Tabs value={unitCardTab} onValueChange={(v) => setUnitCardTab(v as UnitCardTab)}>
          <TabsList className="mb-2 h-7 bg-slate-900/60">
            <TabsTrigger value="overview" className="text-[11px] h-6 px-3">概览</TabsTrigger>
            <TabsTrigger value="chat" className="text-[11px] h-6 px-3">对话</TabsTrigger>
            <TabsTrigger value="timeline" className="text-[11px] h-6 px-3">时间线</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-0">{overviewContent}</TabsContent>
          <TabsContent value="chat" className="mt-0"><ChatPanel /></TabsContent>
          <TabsContent value="timeline" className="mt-0">
            <div className="max-h-[160px] space-y-0.5 overflow-y-auto scrollbar-thin text-xs">
              {timelineEvents.length === 0 ? (
                <p className="py-2 text-center text-slate-600">暂无事件</p>
              ) : (
                timelineEvents.map((e) => (
                  <div key={e.id} className="flex gap-2 py-0.5 text-[11px] text-slate-400">
                    <span className="shrink-0 text-slate-600">{new Date(e.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className="truncate">{e.message}</span>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ── Helper Components ── */

function InfoRow({ label, value, mono, highlight }: { label: string; value: string | number; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`${mono ? 'font-mono text-sky-300/80' : ''} ${highlight ? 'text-amber-400' : 'text-slate-200'} text-[11px]`}>
        {value}
      </span>
    </div>
  );
}

function StatBox({ label, value, error }: { label: string; value: number; error?: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-slate-800/50 px-3 py-1.5">
      <span className={`font-mono text-sm font-bold ${error ? 'text-red-400' : 'text-slate-100'}`}>{value}</span>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

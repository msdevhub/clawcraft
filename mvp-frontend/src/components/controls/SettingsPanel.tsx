import { useMemo } from 'react';
import { useWorldStore } from '@/store/world-store';

interface SettingsPanelProps {
  onClose: () => void;
  onOpenBuilding: (buildingId: string) => void;
  onOpenAgent: (agentId: string) => void;
}

interface IndexCard {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}

export function SettingsPanel({ onClose, onOpenBuilding, onOpenAgent }: SettingsPanelProps) {
  const agents = useWorldStore((s) => s.agents);
  const agentIds = useMemo(() => Object.keys(agents).sort(), [agents]);

  const indexCards = useMemo<IndexCard[]>(() => [
    {
      icon: '📡',
      title: '通讯设置',
      description: '消息行为、TTS 和 Webhook 已并入频道港口。',
      actionLabel: '打开频道港口',
      onClick: () => onOpenBuilding('channels'),
    },
    {
      icon: '⚒️',
      title: '工具配置',
      description: '提权、命令、Exec、Web、循环检测、沙箱和浏览器已并入工具库。',
      actionLabel: '打开工具库',
      onClick: () => onOpenBuilding('tools'),
    },
    {
      icon: '🏰',
      title: 'Gateway 配置',
      description: '日志、发现、Canvas 和 Gateway 高级项已并入 Gateway 面板。',
      actionLabel: '打开 Gateway',
      onClick: () => onOpenBuilding('gateway'),
    },
    {
      icon: '🛠️',
      title: '技能配置',
      description: 'Skills JSON 已并入技能工坊底部。',
      actionLabel: '打开技能工坊',
      onClick: () => onOpenBuilding('skills'),
    },
    {
      icon: '🌿',
      title: '环境变量',
      description: '环境变量仍保留独立面板。',
      actionLabel: '打开环境变量',
      onClick: () => onOpenBuilding('env'),
    },
  ], [onOpenBuilding]);

  return (
    <div className="w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">🗺️</span>
          <div>
            <h2 className="text-base font-bold text-slate-100">配置索引</h2>
            <p className="text-[11px] text-slate-500">高级设置已拆分回各自建筑面板</p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4 scrollbar-thin">
        <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-100">🏛️ Agent 默认行为</p>
              <p className="text-[11px] text-slate-500">Heartbeat / Compaction / Session 已并入每个 Agent 面板。</p>
            </div>
            <span className="rounded-full border border-slate-700/70 px-2 py-1 text-[10px] text-slate-400">{agentIds.length} 个 Agent</span>
          </div>

          {agentIds.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-700/50 px-3 py-3 text-xs text-slate-500">当前没有可打开的 Agent。</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {agentIds.map((agentId) => (
                <button
                  key={agentId}
                  onClick={() => onOpenAgent(agentId)}
                  className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-3 text-left transition-colors hover:border-sky-500/40 hover:bg-slate-900/60"
                >
                  <p className="text-sm font-medium text-slate-200">🏛️ {agentId}</p>
                  <p className="mt-1 text-[11px] text-slate-500">打开 Agent 面板中的默认行为区</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {indexCards.map((card) => (
            <button
              key={card.title}
              onClick={card.onClick}
              className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4 text-left transition-all hover:border-slate-600/80 hover:bg-slate-900/45"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg">{card.icon}</p>
                  <p className="mt-2 text-sm font-medium text-slate-100">{card.title}</p>
                </div>
                <span className="rounded-full border border-slate-700/70 px-2 py-1 text-[10px] text-slate-400">入口</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">{card.description}</p>
              <p className="mt-3 text-[11px] font-medium text-sky-300">{card.actionLabel} →</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

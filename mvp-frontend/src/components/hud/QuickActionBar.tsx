import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorldStore } from '@/store/world-store';

interface QuickActionBarProps {
  onOpenGateway: () => void;
  onOpenBuilding: (buildingId: string) => void;
  onOpenAgent: (agentId: string) => void;
  onToggleChat: () => void;
  onToggleActivity: () => void;
  agentIds: string[];
}

interface MenuItem {
  icon: string;
  label: string;
  action: () => void;
}

const QUICK_ACTIONS = [
  { icon: '🏰', label: 'Gateway', action: 'gateway' as const },
  { icon: '📡', label: '频道', action: 'channels' as const },
  { icon: '🔥', label: '模型', action: 'models' as const },
  { icon: '💬', label: '对话', action: 'chat' as const },
  { icon: '📊', label: '活动', action: 'activity' as const },
];

export function QuickActionBar({
  onOpenGateway,
  onOpenBuilding,
  onOpenAgent,
  onToggleChat,
  onToggleActivity,
  agentIds,
}: QuickActionBarProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const agentActivity = useWorldStore((state) => state.agentActivity);

  useEffect(() => {
    if (!showMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMenu(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMenu]);

  const managementItems = useMemo<MenuItem[]>(() => [
    { icon: '🏰', label: 'Gateway', action: onOpenGateway },
    { icon: '📡', label: '频道', action: () => onOpenBuilding('channels') },
    { icon: '🔥', label: '模型', action: () => onOpenBuilding('models') },
    { icon: '📎', label: '路由绑定', action: () => onOpenBuilding('bindings') },
    { icon: '🌿', label: '环境变量', action: () => onOpenBuilding('env') },
    { icon: '💬', label: '对话', action: onToggleChat },
    { icon: '📊', label: '活动', action: onToggleActivity },
  ], [onOpenBuilding, onOpenGateway, onToggleActivity, onToggleChat]);

  const toolItems = useMemo<MenuItem[]>(() => [
    { icon: '🛠️', label: '技能', action: () => onOpenBuilding('skills') },
    { icon: '🧠', label: '记忆', action: () => onOpenBuilding('memory') },
    { icon: '📜', label: '文件', action: () => onOpenBuilding('files') },
    { icon: '⚒️', label: '工具库', action: () => onOpenBuilding('tools') },
    { icon: '🔌', label: '插件', action: () => onOpenBuilding('plugins') },
    { icon: '⏰', label: '定时任务', action: () => onOpenBuilding('cron') },
  ], [onOpenBuilding]);

  const openItem = (action: () => void) => {
    action();
    setShowMenu(false);
  };

  return (
    <>
      <div className="pointer-events-none absolute bottom-16 left-4 z-20 sm:bottom-20" ref={menuRef}>
        <div className="pointer-events-auto relative">
          {showMenu && (
            <div className="absolute bottom-full left-0 mb-3 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-slate-700/60 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-200">📋 功能目录</h3>
                <button
                  onClick={() => setShowMenu(false)}
                  className="text-slate-500 transition-colors hover:text-slate-300"
                  title="关闭目录"
                >
                  ✕
                </button>
              </div>

              <MenuSection
                title="管理"
                items={managementItems.map((item) => ({
                  ...item,
                  action: () => openItem(item.action),
                }))}
              />

              <div className="mb-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">Agent</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {agentIds.length > 0 ? (
                    agentIds.map((agentId) => (
                      <MenuButton
                        key={agentId}
                        icon="🏛️"
                        label={agentId}
                        indicator={getAgentIndicator(agentActivity[agentId]?.status ?? 'idle')}
                        onClick={() => openItem(() => onOpenAgent(agentId))}
                      />
                    ))
                  ) : (
                    <button
                      disabled
                      className="col-span-3 rounded-xl border border-slate-800/80 bg-slate-900/40 px-2 py-3 text-[10px] text-slate-500"
                    >
                      暂无 Agent
                    </button>
                  )}
                </div>
              </div>

              <MenuSection
                title="工具 & 内容"
                items={toolItems.map((item) => ({
                  ...item,
                  action: () => openItem(item.action),
                }))}
              />
            </div>
          )}

          <button
            onClick={() => setShowMenu((value) => !value)}
            className="flex min-w-[92px] items-center justify-center gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 shadow-2xl backdrop-blur-md transition-all hover:border-slate-500 hover:bg-slate-900/90 hover:text-slate-50"
            title="打开功能目录"
          >
            <span className="text-base leading-none">📋</span>
            <span>全部功能</span>
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-16 left-1/2 z-20 w-[calc(100%-9rem)] max-w-max -translate-x-1/2 sm:bottom-5">
        <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto rounded-2xl border border-slate-700/60 bg-slate-950/55 px-2 py-2 shadow-2xl backdrop-blur-md">
          {QUICK_ACTIONS.map(({ icon, label, action }) => (
            <button
              key={label}
              onClick={() => {
                if (action === 'gateway') {
                  onOpenGateway();
                  return;
                }
                if (action === 'chat') {
                  onToggleChat();
                  return;
                }
                if (action === 'activity') {
                  onToggleActivity();
                  return;
                }
                onOpenBuilding(action);
              }}
              className="flex min-w-[68px] shrink-0 flex-col items-center gap-0.5 rounded-xl border border-slate-700/70 bg-slate-800/85 px-3 py-2 text-slate-300 transition-all hover:border-slate-500 hover:bg-slate-700/90 hover:text-slate-100"
              title={label}
            >
              <span className="text-lg leading-none">{icon}</span>
              <span className="text-[10px] leading-none">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function MenuSection({ title, items }: { title: string; items: MenuItem[] }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">{title}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((item) => (
          <MenuButton key={item.label} icon={item.icon} label={item.label} onClick={item.action} />
        ))}
      </div>
    </div>
  );
}

function getAgentIndicator(status: 'idle' | 'thinking' | 'tooling') {
  if (status === 'tooling') {
    return {
      className: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.45)] animate-pulse',
      title: '工具调用中',
    };
  }

  if (status === 'thinking') {
    return {
      className: 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.4)] animate-pulse',
      title: '思考中',
    };
  }

  return {
    className: 'bg-slate-600',
    title: '空闲',
  };
}

function MenuButton({
  icon,
  label,
  onClick,
  indicator,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  indicator?: { className: string; title: string };
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-xl border border-slate-800/80 bg-slate-900/60 px-2 py-2 text-slate-300 transition-all hover:border-slate-500 hover:bg-slate-700/90 hover:text-slate-100"
      title={label}
    >
      <span className="relative text-base leading-none">
        {icon}
        {indicator ? <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-slate-950 ${indicator.className}`} title={indicator.title} /> : null}
      </span>
      <span className="max-w-full truncate text-[9px] leading-none">{label}</span>
    </button>
  );
}

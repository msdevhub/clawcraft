interface OnboardingWizardProps {
  onOpenChannels: () => void;
  onOpenSkills: () => void;
  onDismiss: () => void;
}

const cards = [
  {
    emoji: '📡',
    title: '连接频道',
    subtitle: '连接你的第一个聊天频道',
    action: 'openChannels' as const,
    buttonText: '打开频道管理 →',
    color: 'sky',
  },
  {
    emoji: '🛠️',
    title: '安装技能',
    subtitle: '从商店安装 Agent 技能',
    action: 'openSkills' as const,
    buttonText: '打开技能工坊 →',
    color: 'emerald',
  },
  {
    emoji: '🏛️',
    title: '探索王国',
    subtitle: '点击建筑或右键查看更多',
    action: 'dismiss' as const,
    buttonText: '开始探索 →',
    color: 'amber',
  },
];

const colorMap: Record<string, string> = {
  sky: 'border-sky-500/30 hover:border-sky-500/60 bg-sky-500/5',
  emerald: 'border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/5',
  amber: 'border-amber-500/30 hover:border-amber-500/60 bg-amber-500/5',
};

const btnColorMap: Record<string, string> = {
  sky: 'bg-sky-600/20 text-sky-400 hover:bg-sky-600/30',
  emerald: 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30',
  amber: 'bg-amber-600/20 text-amber-400 hover:bg-amber-600/30',
};

export function OnboardingWizard({ onOpenChannels, onOpenSkills, onDismiss }: OnboardingWizardProps) {
  const handlers: Record<string, () => void> = {
    openChannels: onOpenChannels,
    openSkills: onOpenSkills,
    dismiss: onDismiss,
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-slate-700/50 bg-slate-950/95 p-8 shadow-2xl backdrop-blur-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <span className="text-5xl">🏰</span>
          <h1 className="mt-3 text-xl font-bold text-slate-100">欢迎来到 ClawCraft！</h1>
          <p className="mt-1 text-sm text-slate-400">你的 OpenClaw 王国正在等待建设</p>
        </div>

        {/* Cards */}
        <div className="space-y-3">
          {cards.map((card) => (
            <div
              key={card.action}
              className={`flex items-center justify-between rounded-xl border p-4 transition-colors ${colorMap[card.color]}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{card.emoji}</span>
                <div>
                  <p className="text-sm font-medium text-slate-200">{card.title}</p>
                  <p className="text-xs text-slate-500">{card.subtitle}</p>
                </div>
              </div>
              <button
                onClick={handlers[card.action]}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${btnColorMap[card.color]}`}
              >
                {card.buttonText}
              </button>
            </div>
          ))}
        </div>

        {/* Skip */}
        <div className="mt-5 text-center">
          <button
            onClick={onDismiss}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            跳过引导
          </button>
        </div>
      </div>
    </div>
  );
}

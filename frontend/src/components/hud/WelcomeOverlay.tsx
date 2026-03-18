interface WelcomeOverlayProps {
  onClose: () => void;
}

export function WelcomeOverlay({ onClose }: WelcomeOverlayProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-slate-700/70 bg-slate-950/95 p-6 shadow-2xl">
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-[0.35em] text-amber-300/80">ClawCraft</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-100">🏰 欢迎来到 ClawCraft!</h1>
          <p className="mt-2 text-sm text-slate-400">你的 AI Agent 王国已就绪。</p>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">快速指南</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>• 🏰 点击城堡，管理 Gateway 全局配置</p>
            <p>• 🏛️ 点击领主大厅，管理 Agent 设置</p>
            <p>• 📡 点击建筑，管理频道、模型、技能等</p>
            <p>• 🧱 右侧工具，布置围墙装饰</p>
            <p>• 🖱️ 拖拽移动建筑位置</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-400/20"
        >
          ✨ 开始探索
        </button>
      </div>
    </div>
  );
}

import { useWorldStore } from '@/store/world-store';

export function DeveloperFilter() {
  const developerMode = useWorldStore((s) => s.developerMode);
  const toggleDeveloperMode = useWorldStore((s) => s.toggleDeveloperMode);

  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggleDeveloperMode(); }}
      className={`rounded-xl border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md transition-colors ${
        developerMode
          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
          : 'border-slate-700/50 bg-slate-950/80 text-slate-400 hover:text-slate-200'
      }`}
    >
      {developerMode ? '🔬 开发者' : '🎮 游戏'}
    </button>
  );
}

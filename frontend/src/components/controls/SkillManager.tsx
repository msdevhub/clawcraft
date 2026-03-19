import { useState, useEffect, useCallback } from 'react';
import { SkillsConfigForm } from '@/components/controls/settings-forms';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { useConfig } from '@/hooks/use-config';
import { authFetch } from '@/lib/auth-fetch';
import { useWorldStore } from '@/store/world-store';

interface SkillManagerProps {
  onClose: () => void;
  inline?: boolean;
}

interface SkillItem {
  slug: string;
  name?: string;
  score?: string;
  version?: string;
  path?: string;
}

const SKILL_ICONS: Record<string, string> = {
  weather: '🌤️', github: '🐙', coding: '💻', tmux: '🖥️',
  obsidian: '📓', video: '🎬', healthcheck: '🛡️', whisper: '🎙️',
  image: '🖼️', clawhub: '📦',
};

function skillIcon(slug: string): string {
  for (const [key, icon] of Object.entries(SKILL_ICONS)) {
    if (slug.toLowerCase().includes(key)) return icon;
  }
  return '🧩';
}

export function SkillManager({ onClose, inline }: SkillManagerProps) {
  const [activeTab, setActiveTab] = useState<'installed' | 'search'>('installed');
  const [installed, setInstalled] = useState<SkillItem[]>([]);
  const [searchResults, setSearchResults] = useState<SkillItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const addEvent = useWorldStore((s) => s.addEvent);
  const { config, loading: configLoading, error: configError, refresh } = useConfig();

  // Load installed skills
  const loadInstalled = useCallback(async () => {
    try {
      const res = await authFetch('/clawcraft/skills');
      const data = await res.json();
      if (data.ok) setInstalled(data.skills || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  // Search
  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await authFetch(`/clawcraft/skills?action=search&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.ok) setSearchResults(data.skills || []);
      else addEvent({ id: `err-${Date.now()}`, type: 'error', message: `搜索失败: ${data.error}`, ts: Date.now() });
    } catch (err: any) {
      addEvent({ id: `err-${Date.now()}`, type: 'error', message: `搜索失败: ${err.message}`, ts: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [query, addEvent]);

  // Install
  const handleInstall = useCallback(async (slug: string) => {
    setActionLoading(slug);
    try {
      const res = await authFetch('/clawcraft/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', slug }),
      });
      const data = await res.json();
      if (data.ok) {
        addEvent({ id: `skill-${Date.now()}`, type: 'info', message: `🏗️ ${slug} 建造完成！`, ts: Date.now() });
        loadInstalled();
      } else {
        addEvent({ id: `err-${Date.now()}`, type: 'error', message: `安装失败: ${data.error}`, ts: Date.now() });
      }
    } catch (err: any) {
      addEvent({ id: `err-${Date.now()}`, type: 'error', message: `安装失败: ${err.message}`, ts: Date.now() });
    } finally {
      setActionLoading(null);
    }
  }, [addEvent, loadInstalled]);

  // Uninstall
  const handleUninstall = useCallback(async (slug: string) => {
    if (!confirm(`确定要拆除 ${slug}？`)) return;
    setActionLoading(slug);
    try {
      const res = await authFetch('/clawcraft/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'uninstall', slug }),
      });
      const data = await res.json();
      if (data.ok) {
        addEvent({ id: `skill-${Date.now()}`, type: 'info', message: `🗑️ ${slug} 已拆除`, ts: Date.now() });
        loadInstalled();
      } else {
        addEvent({ id: `err-${Date.now()}`, type: 'error', message: `卸载失败: ${data.error}`, ts: Date.now() });
      }
    } catch (err: any) {
      addEvent({ id: `err-${Date.now()}`, type: 'error', message: `卸载失败: ${err.message}`, ts: Date.now() });
    } finally {
      setActionLoading(null);
    }
  }, [addEvent, loadInstalled]);

  // Test a skill
  const handleTestSkill = useCallback(async (slug: string) => {
    setActionLoading(slug);
    setTestResults(prev => ({ ...prev, [slug]: { ok: true, message: '⏳ 测试中...' } }));
    try {
      const res = await authFetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'skill.test', params: { slug } }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestResults(prev => ({ ...prev, [slug]: { ok: true, message: `✅ ${data.message || '测试通过'}` } }));
        addEvent({ id: `skill-test-${Date.now()}`, type: 'info', message: `🧪 ${slug} 测试通过`, ts: Date.now() });
        (window as any).__floatText?.('skills', `✅ ${slug} 测试通过`, 0x22c55e);
      } else {
        setTestResults(prev => ({ ...prev, [slug]: { ok: false, message: `❌ ${data.error || '测试失败'}` } }));
      }
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [slug]: { ok: false, message: `❌ ${err.message}` } }));
    } finally {
      setActionLoading(null);
    }
  }, [addEvent]);

  // Update all
  const handleUpdateAll = useCallback(async () => {
    setActionLoading('__all__');
    try {
      const res = await authFetch('/clawcraft/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update' }),
      });
      const data = await res.json();
      if (data.ok) {
        addEvent({ id: `skill-${Date.now()}`, type: 'info', message: '🔄 全部技能已升级', ts: Date.now() });
        loadInstalled();
      }
    } catch { /* ignore */ }
    finally { setActionLoading(null); }
  }, [addEvent, loadInstalled]);

  const installedSlugs = new Set(installed.map(s => s.slug));

  return (
    <div className={inline ? "" : "fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"} onClick={inline ? undefined : onClose}>
      <div className={`flex flex-col rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md ${inline ? "w-full max-h-[60vh]" : "mx-4 h-[80vh] w-full max-w-2xl"}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛠️</span>
            <h2 className="text-base font-bold text-slate-100">技能工坊</h2>
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">Skills</span>
            <span className="ml-2 rounded bg-emerald-900/50 px-2 py-0.5 text-[10px] text-emerald-400">{installed.length} 已装</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleUpdateAll}
              disabled={actionLoading !== null}
              className="rounded-lg px-3 py-1 text-[10px] text-sky-400 hover:bg-sky-900/30 disabled:opacity-50"
            >
              🔄 全部升级
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700/30 px-5">
          {[
            { id: 'installed' as const, label: `🏛️ 已建造 (${installed.length})` },
            { id: 'search' as const, label: '🔍 探索商店' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {activeTab === 'installed' && (
            <div className="space-y-2">
              {installed.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-slate-600">
                  <span className="text-4xl">🏚️</span>
                  <p className="text-sm">尚无技能建筑</p>
                  <button
                    onClick={() => setActiveTab('search')}
                    className="rounded-lg bg-emerald-600/20 px-4 py-2 text-xs text-emerald-400 hover:bg-emerald-600/30"
                  >
                    前往商店 →
                  </button>
                </div>
              ) : (
                installed.map(skill => (
                  <div key={skill.slug} className="rounded-xl border border-slate-700/30 px-4 py-3 hover:border-slate-600/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{skillIcon(skill.slug)}</span>
                        <div>
                          <p className="text-sm font-medium text-slate-200">{skill.slug}</p>
                          {skill.version && <p className="text-[10px] text-slate-500">v{skill.version}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleTestSkill(skill.slug)}
                          disabled={actionLoading === skill.slug}
                          className="rounded-lg px-3 py-1.5 text-[10px] text-sky-400 hover:bg-sky-900/30 disabled:opacity-50"
                        >
                          {actionLoading === skill.slug ? '⏳' : '🧪 测试'}
                        </button>
                        <button
                          onClick={() => handleUninstall(skill.slug)}
                          disabled={actionLoading === skill.slug}
                          className="rounded-lg px-3 py-1.5 text-[10px] text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                        >
                          {actionLoading === skill.slug ? '⏳' : '🗑️ 拆除'}
                        </button>
                      </div>
                    </div>
                    {testResults[skill.slug] && (
                      <div className={`mt-2 rounded-lg p-2 text-[11px] font-mono ${testResults[skill.slug].ok ? 'bg-emerald-900/20 text-emerald-400' : 'bg-red-900/20 text-red-400'}`}>
                        {testResults[skill.slug].message}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'search' && (
            <div className="space-y-4">
              {/* Search bar */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="搜索技能... (例: weather, github, coding)"
                  className="flex-1 rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none"
                />
                <button
                  onClick={handleSearch}
                  disabled={loading || !query.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? '⏳' : '🔍'}
                </button>
              </div>

              {/* Results */}
              <div className="space-y-2">
                {searchResults.length === 0 && !loading && (
                  <div className="flex flex-col items-center gap-2 py-8 text-slate-600">
                    <span className="text-3xl">🏪</span>
                    <p className="text-sm">搜索 ClawHub 技能商店</p>
                    <p className="text-[10px]">输入关键词查找可用技能</p>
                  </div>
                )}
                {searchResults.map((skill, i) => {
                  const isInstalled = installedSlugs.has(skill.slug);
                  return (
                    <div key={`${skill.slug}-${i}`} className="flex items-center justify-between rounded-xl border border-slate-700/30 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{skillIcon(skill.slug)}</span>
                        <div>
                          <p className="text-sm font-medium text-slate-200">{skill.name || skill.slug}</p>
                          <div className="flex gap-2 text-[10px] text-slate-500">
                            <span className="font-mono">{skill.slug}</span>
                            {skill.score && <span>⭐ {parseFloat(skill.score).toFixed(1)}</span>}
                          </div>
                        </div>
                      </div>
                      {isInstalled ? (
                        <span className="rounded-lg bg-emerald-900/30 px-3 py-1.5 text-[10px] text-emerald-400">✓ 已建造</span>
                      ) : (
                        <button
                          onClick={() => handleInstall(skill.slug)}
                          disabled={actionLoading === skill.slug}
                          className="rounded-lg bg-sky-600/20 px-3 py-1.5 text-[10px] text-sky-400 hover:bg-sky-600/30 disabled:opacity-50"
                        >
                          {actionLoading === skill.slug ? '⏳ 建造中...' : '🏗️ 建造'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5 space-y-3 border-t border-slate-700/30 pt-5">
            <div>
              <p className="text-sm font-medium text-slate-100">技能配置</p>
              <p className="text-[11px] text-slate-500">`skills` JSON 已并入技能工坊，便于在安装列表旁直接维护。</p>
            </div>

            {configLoading ? (
              <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 px-4 py-3 text-sm text-slate-500">⏳ 加载配置中...</div>
            ) : configError ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">❌ {configError}</div>
            ) : (
              <CollapsibleSection icon="⚙️" title="技能配置" subtitle="skills">
                <SkillsConfigForm config={config} onConfigRefresh={refresh} />
              </CollapsibleSection>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

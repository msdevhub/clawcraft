import { useState, useCallback } from 'react';
import { useWorldStore } from '@/store/world-store';

interface MemoryPanelProps {
  agentId?: string;
  onClose: () => void;
  inline?: boolean;
}

interface MemoryEntry {
  id: string;
  text: string;
  category?: string;
  importance?: number;
  createdAt?: string;
  scope?: string;
}

export function MemoryPanel({ agentId = 'main', onClose, inline }: MemoryPanelProps) {
  const [activeTab, setActiveTab] = useState<'recall' | 'store' | 'manage'>('recall');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Store form
  const [storeText, setStoreText] = useState('');
  const [storeCategory, setStoreCategory] = useState('fact');
  const [storeImportance, setStoreImportance] = useState(0.7);

  const addEvent = useWorldStore((s) => s.addEvent);

  const handleRecall = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/clawcraft/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recall', agentId, query, limit: 10 }),
      });
      const data = await res.json();
      if (data.ok && data.results) {
        setResults(data.results);
      } else if (data.result) {
        // The tool result may be a string; parse it
        try {
          const parsed = JSON.parse(data.result);
          setResults(Array.isArray(parsed) ? parsed : parsed.memories || []);
        } catch {
          setResults([{ id: 'raw', text: data.result }]);
        }
      } else {
        setResults([]);
      }
    } catch (err: any) {
      addEvent({ id: `err-${Date.now()}`, type: 'error', message: `记忆搜索失败: ${err.message}`, ts: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [query, agentId, addEvent]);

  const handleStore = useCallback(async () => {
    if (!storeText.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/clawcraft/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'store', agentId,
          text: storeText, category: storeCategory, importance: storeImportance,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        addEvent({ id: `mem-${Date.now()}`, type: 'info', message: `🧠 新记忆已存储`, ts: Date.now() });
        setStoreText('');
      } else {
        addEvent({ id: `err-${Date.now()}`, type: 'error', message: `存储失败: ${data.error}`, ts: Date.now() });
      }
    } catch (err: any) {
      addEvent({ id: `err-${Date.now()}`, type: 'error', message: `存储失败: ${err.message}`, ts: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [storeText, storeCategory, storeImportance, agentId, addEvent]);

  const handleForget = useCallback(async (memoryId: string) => {
    if (!confirm('确定要删除这条记忆？')) return;
    try {
      const res = await fetch('/clawcraft/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forget', agentId, memoryId }),
      });
      const data = await res.json();
      if (data.ok) {
        setResults(prev => prev.filter(r => r.id !== memoryId));
        addEvent({ id: `mem-${Date.now()}`, type: 'info', message: `🗑️ 记忆已删除`, ts: Date.now() });
      }
    } catch (err: any) {
      addEvent({ id: `err-${Date.now()}`, type: 'error', message: `删除失败: ${err.message}`, ts: Date.now() });
    }
  }, [agentId, addEvent]);

  const CATEGORIES = [
    { value: 'preference', label: '🎯 偏好', color: 'text-purple-400' },
    { value: 'fact', label: '📌 事实', color: 'text-blue-400' },
    { value: 'decision', label: '⚖️ 决策', color: 'text-amber-400' },
    { value: 'entity', label: '🏷️ 实体', color: 'text-emerald-400' },
    { value: 'reflection', label: '💭 反思', color: 'text-pink-400' },
    { value: 'other', label: '📝 其他', color: 'text-slate-400' },
  ];

  return (
    <div className={inline ? "" : "fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"} onClick={inline ? undefined : onClose}>
      <div className="mx-4 flex h-[75vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧠</span>
            <h2 className="text-base font-bold text-slate-100">记忆宝库</h2>
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">Memory</span>
            <span className="ml-2 rounded bg-sky-900/50 px-2 py-0.5 text-[10px] text-sky-400">{agentId}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700/30 px-5">
          {[
            { id: 'recall' as const, label: '🔍 搜索', },
            { id: 'store' as const, label: '✨ 存储', },
            { id: 'manage' as const, label: '📚 管理', },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-sky-500 text-sky-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {activeTab === 'recall' && (
            <div className="space-y-4">
              {/* Search bar */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRecall()}
                  placeholder="搜索记忆... (支持语义搜索)"
                  className="flex-1 rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none"
                />
                <button
                  onClick={handleRecall}
                  disabled={loading || !query.trim()}
                  className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? '⏳' : '🔍'}
                </button>
              </div>

              {/* Results */}
              <div className="space-y-2">
                {results.length === 0 && !loading && (
                  <p className="py-4 text-center text-sm text-slate-600">输入关键词搜索 Agent 的长期记忆</p>
                )}
                {results.map((entry, i) => (
                  <div key={entry.id || i} className="rounded-xl border border-slate-700/30 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex-1 text-sm leading-relaxed text-slate-300">{entry.text}</p>
                      <button
                        onClick={() => handleForget(entry.id)}
                        className="shrink-0 text-xs text-slate-600 hover:text-red-400"
                        title="删除记忆"
                      >
                        🗑️
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2 text-[10px] text-slate-600">
                      {entry.category && (
                        <span className={CATEGORIES.find(c => c.value === entry.category)?.color || 'text-slate-400'}>
                          {entry.category}
                        </span>
                      )}
                      {entry.importance !== undefined && (
                        <span>重要度: {(entry.importance * 100).toFixed(0)}%</span>
                      )}
                      {entry.createdAt && <span>{new Date(entry.createdAt).toLocaleString('zh-CN')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'store' && (
            <div className="space-y-4">
              <textarea
                value={storeText}
                onChange={e => setStoreText(e.target.value)}
                placeholder="输入要存储的记忆内容..."
                rows={5}
                className="w-full resize-none rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none"
              />

              {/* Category selector */}
              <div>
                <label className="mb-2 block text-xs text-slate-500">分类</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      onClick={() => setStoreCategory(cat.value)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        storeCategory === cat.value
                          ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/40'
                          : 'bg-slate-800/50 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Importance slider */}
              <div>
                <label className="mb-2 flex items-center justify-between text-xs text-slate-500">
                  <span>重要度</span>
                  <span className="text-sky-400">{(storeImportance * 100).toFixed(0)}%</span>
                </label>
                <input
                  type="range"
                  min="0" max="1" step="0.05"
                  value={storeImportance}
                  onChange={e => setStoreImportance(parseFloat(e.target.value))}
                  className="w-full accent-sky-500"
                />
              </div>

              <button
                onClick={handleStore}
                disabled={loading || !storeText.trim()}
                className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? '存储中...' : '✨ 刻入记忆'}
              </button>
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                搜索记忆后可以在结果中删除。记忆管理高级功能（批量操作、导出）将在 Wave 3 上线。
              </p>
              <div className="rounded-xl border border-dashed border-slate-700/30 p-8 text-center">
                <p className="text-3xl">🏛️</p>
                <p className="mt-2 text-sm text-slate-500">记忆殿堂 · 高级管理</p>
                <p className="mt-1 text-[10px] text-slate-600">即将到来...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

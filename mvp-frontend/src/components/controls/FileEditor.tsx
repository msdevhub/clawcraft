import { useState, useEffect, useCallback } from 'react';
import { useWorldStore } from '@/store/world-store';

interface FileEditorProps {
  agentId: string;
  initialFile?: string;
  onClose: () => void;
  inline?: boolean;
}

const FILE_ICONS: Record<string, string> = {
  'SOUL.md': '👻',
  'AGENTS.md': '📋',
  'TOOLS.md': '🔧',
  'IDENTITY.md': '🪪',
  'USER.md': '👤',
  'BOOTSTRAP.md': '🚀',
  'HEARTBEAT.md': '💓',
};

export function FileEditor({ agentId, initialFile, onClose, inline }: FileEditorProps) {
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>(initialFile || '');
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'modified' | 'saved' | 'error'>('idle');
  const addEvent = useWorldStore((s) => s.addEvent);

  // Load file list
  useEffect(() => {
    fetch(`/clawcraft/files?agentId=${encodeURIComponent(agentId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) setFiles(data.files);
      });
  }, [agentId]);

  // Load file content
  useEffect(() => {
    if (!selectedFile) return;
    setLoading(true);
    setStatus('idle');
    fetch(`/clawcraft/files?agentId=${encodeURIComponent(agentId)}&file=${encodeURIComponent(selectedFile)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setContent(data.content);
          setOriginalContent(data.content);
        }
      })
      .finally(() => setLoading(false));
  }, [agentId, selectedFile]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setStatus(newContent !== originalContent ? 'modified' : 'idle');
  }, [originalContent]);

  const handleSave = useCallback(async () => {
    if (!selectedFile || content === originalContent) return;
    setSaving(true);
    try {
      const res = await fetch('/clawcraft/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, file: selectedFile, content }),
      });
      const data = await res.json();
      if (data.ok) {
        setOriginalContent(content);
        setStatus('saved');
        addEvent({
          id: `file-${Date.now()}`,
          type: 'info',
          message: `📝 ${selectedFile} 已保存`,
          ts: Date.now(),
        });
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        setStatus('error');
        addEvent({ id: `err-${Date.now()}`, type: 'error', message: `保存失败: ${data.error}`, ts: Date.now() });
      }
    } catch (err: any) {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }, [agentId, selectedFile, content, originalContent, addEvent]);

  // Keyboard shortcut: Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const isDirty = content !== originalContent;

  return (
    <div className={inline ? "" : "fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"} onClick={inline ? undefined : onClose}>
      <div className="mx-4 flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📜</span>
            <h2 className="text-base font-bold text-slate-100">领主档案</h2>
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">Files</span>
            <span className="ml-2 rounded bg-sky-900/50 px-2 py-0.5 text-[10px] text-sky-400">{agentId}</span>
          </div>
          <div className="flex items-center gap-3">
            {status === 'modified' && <span className="text-[10px] text-amber-400">● 未保存</span>}
            {status === 'saved' && <span className="text-[10px] text-emerald-400">✓ 已保存</span>}
            {status === 'error' && <span className="text-[10px] text-red-400">✗ 保存失败</span>}
            <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">✕</button>
          </div>
        </div>

        {/* File tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-700/30 px-4 py-2">
          {files.map(f => (
            <button
              key={f.name}
              onClick={() => setSelectedFile(f.name)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedFile === f.name
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              <span>{FILE_ICONS[f.name] || '📄'}</span>
              {f.name}
              <span className="text-[9px] text-slate-600">{Math.round(f.size / 1024)}KB</span>
            </button>
          ))}
          {files.length === 0 && <span className="text-xs text-slate-600">没有找到配置文件</span>}
        </div>

        {/* Editor area */}
        <div className="relative flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center text-slate-500">⏳ 加载中...</div>
          ) : !selectedFile ? (
            <div className="flex h-full items-center justify-center text-slate-600">← 选择一个文件开始编辑</div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              className="h-full w-full resize-none bg-transparent px-5 py-4 font-mono text-sm leading-relaxed text-slate-300 focus:outline-none"
              spellCheck={false}
              placeholder="文件内容..."
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-700/30 px-5 py-3">
          <div className="text-[10px] text-slate-600">
            {selectedFile && `${content.split('\n').length} 行 · ${content.length} 字符`}
            {isDirty && ' · Ctrl+S 保存'}
          </div>
          <div className="flex gap-2">
            {isDirty && (
              <button
                onClick={() => { setContent(originalContent); setStatus('idle'); }}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                撤销
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
                isDirty
                  ? 'bg-sky-600 text-white hover:bg-sky-500'
                  : 'cursor-not-allowed bg-slate-800 text-slate-600'
              }`}
            >
              {saving ? '保存中...' : '💾 保存铭文'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

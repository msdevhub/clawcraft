import { useEffect, useRef, useState } from 'react';
import { useWorldStore } from '@/store/world-store';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(value: string) {
  const blocks: string[] = [];
  const withPlaceholders = value.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const index = blocks.push(
      `<pre class="overflow-x-auto rounded-xl bg-slate-950/90 px-3 py-2 text-[11px] text-slate-200"><code>${escapeHtml(String(code).trim())}</code></pre>`,
    ) - 1;
    return `@@CODE_${index}@@`;
  });

  let html = escapeHtml(withPlaceholders);
  html = html.replace(/`([^`]+)`/g, '<code class="rounded bg-slate-950/80 px-1 py-0.5 text-[11px] text-cyan-200">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\n/g, '<br />');

  return html.replace(/@@CODE_(\d+)@@/g, (_match, index) => blocks[Number(index)] ?? '');
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSessionStatusLabel(status?: string) {
  switch (status) {
    case 'thinking':
      return '思考中';
    case 'tooling':
      return '工具调用';
    case 'responding':
      return '回复中';
    case 'blocked':
      return '阻塞';
    case 'ended':
      return '已结束';
    case 'idle':
      return '待机';
    default:
      return '未开始';
  }
}

export function ChatDrawer() {
  const chatDrawerOpen = useWorldStore((state) => state.chatDrawerOpen);
  const setChatDrawerOpen = useWorldStore((state) => state.setChatDrawerOpen);
  const chatTargetAgent = useWorldStore((state) => state.chatTargetAgent);
  const setChatTargetAgent = useWorldStore((state) => state.setChatTargetAgent);
  const agents = useWorldStore((state) => state.agents);
  const sessions = useWorldStore((state) => state.sessions);
  const chatSessionKey = useWorldStore((state) => state.chatSessionKey);
  const chatMessages = useWorldStore((state) => state.chatMessages);
  const chatLoading = useWorldStore((state) => state.chatLoading);
  const sendMessage = useWorldStore((state) => state.sendMessage);
  const loadChatHistory = useWorldStore((state) => state.loadChatHistory);

  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const agentIds = Object.keys(agents).sort();
  const activeSession = chatSessionKey ? sessions[chatSessionKey] : null;

  useEffect(() => {
    if (chatDrawerOpen && chatSessionKey) {
      void loadChatHistory(chatSessionKey);
    }
  }, [chatDrawerOpen, chatSessionKey, loadChatHistory]);

  useEffect(() => {
    if (!chatDrawerOpen) {
      return;
    }

    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatDrawerOpen, chatLoading, chatMessages]);

  const handleSend = async () => {
    if (!input.trim() || chatLoading) {
      return;
    }

    const nextMessage = input;
    setInput('');
    await sendMessage(nextMessage);
  };

  return (
    <div
      className={`pointer-events-auto absolute bottom-4 right-4 top-16 z-30 w-[calc(100%-2rem)] max-w-[400px] transition-transform duration-300 ${
        chatDrawerOpen ? 'translate-x-0 opacity-100' : 'translate-x-[110%] opacity-0 pointer-events-none'
      }`}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-slate-700/40 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <span>💬</span>
              <span>对话面板</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {activeSession ? `${getSessionStatusLabel(activeSession.status)} · ${activeSession.sessionKey.slice(0, 18)}` : '选择 Agent 直接开始对话'}
            </p>
          </div>
          <button
            onClick={() => setChatDrawerOpen(false)}
            className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-2 py-1 text-xs text-slate-400 transition-colors hover:text-slate-100"
          >
            收起
          </button>
        </div>

        <div className="grid gap-3 border-b border-slate-700/30 px-4 py-3">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Agent</span>
            <select
              value={chatTargetAgent}
              onChange={(event) => setChatTargetAgent(event.target.value)}
              className="w-full rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none"
            >
              {(agentIds.length > 0 ? agentIds : ['main']).map((agentId) => (
                <option key={agentId} value={agentId}>
                  {agentId}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-900/60 px-3 py-2 text-xs">
            <span className="text-slate-500">Session</span>
            <span className="text-slate-200">{chatSessionKey ? chatSessionKey.slice(0, 22) : '新会话'}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            {chatMessages.length === 0 && !chatLoading ? (
              <div className="rounded-2xl border border-dashed border-slate-700/50 bg-slate-900/30 px-4 py-6 text-center text-sm text-slate-500">
                还没有消息，直接向 {chatTargetAgent || 'agent'} 发一条指令。
              </div>
            ) : null}

            {chatMessages.map((message) => {
              const isUser = message.role === 'user';
              const isTool = message.role === 'tool' || Boolean(message.toolName);
              return (
                <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {isTool ? (
                    <details className="w-full max-w-[88%] rounded-2xl border border-amber-500/20 bg-amber-500/10">
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-amber-200">
                        🔧 {message.toolName || 'tool'} <span className="ml-1 text-amber-300/70">展开结果</span>
                      </summary>
                      <div className="border-t border-amber-500/10 px-3 py-2 text-xs text-amber-50">
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                      </div>
                    </details>
                  ) : (
                    <div className={`max-w-[88%] rounded-2xl px-3 py-2 ${isUser ? 'bg-sky-600/85 text-white' : 'bg-slate-800/80 text-slate-100'}`}>
                      <div
                        className="text-sm leading-6"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                      />
                      <div className={`mt-2 text-[10px] ${isUser ? 'text-sky-100/80' : 'text-slate-500'}`}>
                        {formatTime(message.timestamp)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {chatLoading ? (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-slate-800/80 px-3 py-2 text-sm text-slate-300">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce [animation-delay:-0.2s]">.</span>
                    <span className="animate-bounce [animation-delay:-0.1s]">.</span>
                    <span className="animate-bounce">.</span>
                  </span>
                </div>
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-slate-700/30 px-4 py-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder={`给 ${chatTargetAgent || 'agent'} 发消息...`}
            className="min-h-[92px] w-full resize-none rounded-2xl border border-slate-700/70 bg-slate-900/70 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            disabled={chatLoading}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500">Enter 发送，Shift+Enter 换行</span>
            <button
              onClick={() => void handleSend()}
              disabled={chatLoading || !input.trim()}
              className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {chatLoading ? '发送中...' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

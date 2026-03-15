import { useRef, useState, useEffect } from 'react';
import { useWorldStore } from '@/store/world-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ChatPanel() {
  const chatSessionKey = useWorldStore((s) => s.chatSessionKey);
  const chatMessages = useWorldStore((s) => s.chatMessages);
  const chatLoading = useWorldStore((s) => s.chatLoading);
  const sendMessage = useWorldStore((s) => s.sendMessage);
  const loadChatHistory = useWorldStore((s) => s.loadChatHistory);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatSessionKey) {
      loadChatHistory(chatSessionKey);
    }
  }, [chatSessionKey, loadChatHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  if (!chatSessionKey) {
    return <p className="text-sm text-slate-500">选择一个 Session 或 Agent 以开启对话</p>;
  }

  const handleSend = () => {
    if (input.trim()) {
      sendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <ScrollArea className="h-48 rounded-lg border border-slate-800/60 bg-slate-900/40 p-3">
        <div className="space-y-2">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                  msg.role === 'user'
                    ? 'bg-sky-600/30 text-sky-100'
                    : msg.role === 'tool'
                    ? 'bg-amber-600/20 text-amber-200'
                    : 'bg-slate-800/60 text-slate-200'
                }`}
              >
                {msg.toolName && <p className="mb-1 text-[10px] font-medium text-amber-400">🔧 {msg.toolName}</p>}
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
              <span className="mt-0.5 text-[10px] text-slate-600">
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN')}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="发送消息..."
          className="flex-1 border-slate-700 bg-slate-900/60 text-sm text-slate-200 placeholder:text-slate-500"
          disabled={chatLoading}
        />
        <Button
          onClick={handleSend}
          disabled={chatLoading || !input.trim()}
          size="sm"
          className="bg-sky-600 text-white hover:bg-sky-500"
        >
          {chatLoading ? '...' : '发送'}
        </Button>
      </div>
    </div>
  );
}

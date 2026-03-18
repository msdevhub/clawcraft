import { useState } from 'react';
import {
  BrowserForm,
  CommandsForm,
  ElevatedForm,
  ExecForm,
  LoopDetectionForm,
  SandboxForm,
  WebToolsForm,
} from '@/components/controls/settings-forms';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfig } from '@/hooks/use-config';
import { useWorldStore } from '@/store/world-store';

interface ToolsPanelProps {
  onClose: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  gather: '🔍',
  observe: '👁️',
  build: '🔨',
  forge: '🔥',
  memory: '🧠',
  message: '💬',
  spawn: '🚀',
  other: '⚙️',
};

export function ToolsPanel({ onClose }: ToolsPanelProps) {
  const buildings = useWorldStore((s) => s.buildings);
  const toolsBuilding = buildings.find((building) => building.id === 'tools');
  const items = toolsBuilding?.items || [];
  const totalCount = toolsBuilding?.count || 0;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { config, loading, error, refresh } = useConfig();

  const toggleExpand = (category: string) => {
    setExpanded((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <div className="w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚒️</span>
          <h2 className="text-base font-bold text-slate-100">工具库</h2>
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-400">
            共 {totalCount} 个工具
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-4 scrollbar-thin">
        <Tabs defaultValue="directory" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="directory">🗂️ 工具目录</TabsTrigger>
            <TabsTrigger value="config">⚙️ 工具配置</TabsTrigger>
          </TabsList>

          <TabsContent value="directory" className="space-y-2">
            {items.length === 0 ? (
              <div className="py-8 text-center">
                <p className="mb-2 text-2xl">🔨</p>
                <p className="text-sm text-slate-500">工具库空空如也…</p>
                <p className="mt-1 text-xs text-slate-600">铁砧已冷却，等待工匠到来</p>
              </div>
            ) : (
              items.map((item) => {
                const tools = Array.isArray(item.tools)
                  ? item.tools
                  : item.status?.split(', ').filter(Boolean) || [];
                const isExpanded = expanded[item.name];

                return (
                  <div key={item.name} className="overflow-hidden rounded-xl border border-slate-700/30">
                    <button
                      onClick={() => toggleExpand(item.name)}
                      className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-slate-800/30"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{CATEGORY_ICONS[item.name] || '⚙️'}</span>
                        <span className="text-sm font-medium text-slate-200">{item.name}</span>
                        {item.detail && (
                          <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-[10px] text-slate-400">
                            {item.detail}
                          </span>
                        )}
                      </div>
                      <span className={`text-xs text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                    {isExpanded && tools.length > 0 && (
                      <div className="space-y-1 border-t border-slate-700/20 px-4 py-2">
                        {tools.map((tool) => (
                          <div key={tool} className="flex items-center gap-2 py-1 text-xs text-slate-400">
                            <span className="text-slate-600">•</span>
                            <span className="font-mono">{tool}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="config" className="space-y-3">
            {loading ? (
              <div className="py-8 text-center text-slate-500">⏳ 加载配置中...</div>
            ) : error ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">❌ {error}</div>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-slate-100">工具配置</p>
                  <p className="text-[11px] text-slate-500">提权、命令、Exec、联网能力和安全阈值集中在这里。</p>
                </div>

                <CollapsibleSection icon="🔓" title="提权" subtitle="tools.elevated">
                  <ElevatedForm config={config} onConfigRefresh={refresh} />
                </CollapsibleSection>

                <CollapsibleSection icon="📜" title="命令" subtitle="commands">
                  <CommandsForm config={config} onConfigRefresh={refresh} />
                </CollapsibleSection>

                <CollapsibleSection icon="⚡" title="Exec" subtitle="tools.exec">
                  <ExecForm config={config} onConfigRefresh={refresh} />
                </CollapsibleSection>

                <CollapsibleSection icon="🌐" title="Web" subtitle="tools.web">
                  <WebToolsForm config={config} onConfigRefresh={refresh} />
                </CollapsibleSection>

                <CollapsibleSection icon="🔁" title="循环检测" subtitle="tools.loopDetection">
                  <LoopDetectionForm config={config} onConfigRefresh={refresh} />
                </CollapsibleSection>

                <CollapsibleSection icon="🏖️" title="沙箱" subtitle="agents.defaults.sandbox">
                  <SandboxForm config={config} onConfigRefresh={refresh} />
                </CollapsibleSection>

                <CollapsibleSection icon="🌍" title="浏览器" subtitle="browser">
                  <BrowserForm config={config} onConfigRefresh={refresh} />
                </CollapsibleSection>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

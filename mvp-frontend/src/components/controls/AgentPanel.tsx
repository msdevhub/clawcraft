import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { CompactionForm, HeartbeatForm, SessionForm } from '@/components/controls/settings-forms';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { Input } from '@/components/ui/input';
import { useWorldStore } from '@/store/world-store';

interface AgentPanelProps {
  agentId: string;
  onClose: () => void;
}

interface AgentIdentityForm {
  model: string;
  name: string;
  emoji: string;
  theme: string;
  avatar: string;
  description: string;
}

interface AgentToolsForm {
  profile: string;
  allow: string;
  deny: string;
  elevatedEnabled: boolean;
}

interface AgentAdvancedForm {
  runtimeType: string;
  runtimeAcpAgent: string;
  runtimeAcpBackend: string;
  allowAgents: string[];
  mentionPatterns: string[];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listToText(value: unknown): string {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').join(', ') : '';
}

function textToList(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function buildIdentityForm(agentConfig: any, fallbackModel: string): AgentIdentityForm {
  return {
    model: agentConfig?.model || fallbackModel || '',
    name: agentConfig?.identity?.name || agentConfig?.name || '',
    emoji: agentConfig?.identity?.emoji || '',
    theme: agentConfig?.identity?.theme || '',
    avatar: agentConfig?.identity?.avatar || '',
    description: agentConfig?.identity?.description || '',
  };
}

function buildToolsForm(agentConfig: any): AgentToolsForm {
  const tools = isRecord(agentConfig?.tools) ? agentConfig.tools : {};
  const elevated = isRecord(tools.elevated) ? tools.elevated : {};
  return {
    profile: typeof tools.profile === 'string' ? tools.profile : '',
    allow: listToText(tools.allow),
    deny: listToText(tools.deny),
    elevatedEnabled: Boolean(elevated.enabled),
  };
}

function buildAdvancedForm(agentConfig: any): AgentAdvancedForm {
  const runtime = isRecord(agentConfig?.runtime) ? agentConfig.runtime : {};
  const runtimeAcp = isRecord(runtime.acp) ? runtime.acp : {};
  const subagents = isRecord(agentConfig?.subagents) ? agentConfig.subagents : {};
  const groupChat = isRecord(agentConfig?.groupChat) ? agentConfig.groupChat : {};
  return {
    runtimeType: typeof runtime.type === 'string' ? runtime.type : 'default',
    runtimeAcpAgent: typeof runtimeAcp.agent === 'string' ? runtimeAcp.agent : '',
    runtimeAcpBackend: typeof runtimeAcp.backend === 'string' ? runtimeAcp.backend : '',
    allowAgents: Array.isArray(subagents.allowAgents) ? subagents.allowAgents.filter((entry): entry is string => typeof entry === 'string') : [],
    mentionPatterns: Array.isArray(groupChat.mentionPatterns) ? groupChat.mentionPatterns.filter((entry): entry is string => typeof entry === 'string') : [],
  };
}

function collectModelOptions(config: any): string[] {
  const values = new Set<string>();
  const defaultModel = config?.agents?.defaults?.model;

  if (typeof defaultModel === 'string' && defaultModel) values.add(defaultModel);
  if (isRecord(defaultModel) && typeof defaultModel.primary === 'string' && defaultModel.primary) values.add(defaultModel.primary);
  if (isRecord(defaultModel) && Array.isArray(defaultModel.fallbacks)) {
    for (const fallback of defaultModel.fallbacks) {
      if (typeof fallback === 'string' && fallback) values.add(fallback);
    }
  }

  for (const agentEntry of Array.isArray(config?.agents?.list) ? config.agents.list : []) {
    if (typeof agentEntry?.model === 'string' && agentEntry.model) values.add(agentEntry.model);
  }

  const providers = isRecord(config?.models?.providers) ? config.models.providers : {};
  for (const [providerName, providerConfig] of Object.entries(providers)) {
    if (typeof (providerConfig as any)?.defaultModel === 'string' && (providerConfig as any).defaultModel) {
      values.add(`${providerName}/${(providerConfig as any).defaultModel}`);
    }
    if (typeof (providerConfig as any)?.model === 'string' && (providerConfig as any).model) {
      values.add(`${providerName}/${(providerConfig as any).model}`);
    }
    const models = (providerConfig as any)?.models;
    if (Array.isArray(models)) {
      for (const modelEntry of models) {
        if (typeof modelEntry === 'string' && modelEntry) {
          values.add(`${providerName}/${modelEntry}`);
        } else if (isRecord(modelEntry) && typeof modelEntry.id === 'string' && modelEntry.id) {
          values.add(`${providerName}/${modelEntry.id}`);
        }
      }
    }
  }

  return Array.from(values).sort();
}

export function AgentPanel({ agentId, onClose }: AgentPanelProps) {
  const agent = useWorldStore((s) => s.agents[agentId]);
  const sessions = useWorldStore((s) => s.sessions);
  const addEvent = useWorldStore((s) => s.addEvent);

  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [identityForm, setIdentityForm] = useState<AgentIdentityForm>({
    model: '',
    name: '',
    emoji: '',
    theme: '',
    avatar: '',
    description: '',
  });
  const [toolsForm, setToolsForm] = useState<AgentToolsForm>({
    profile: '',
    allow: '',
    deny: '',
    elevatedEnabled: false,
  });
  const [advancedForm, setAdvancedForm] = useState<AgentAdvancedForm>({
    runtimeType: 'default',
    runtimeAcpAgent: '',
    runtimeAcpBackend: '',
    allowAgents: [],
    mentionPatterns: [],
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);

  const loadConfig = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);

    try {
      const response = await fetch('/clawcraft/config');
      const data = await response.json();
      if (data.ok) {
        setConfig(data.config);
      } else {
        setActionResult({ ok: false, message: data.error || '读取配置失败' });
      }
    } catch (err: any) {
      setActionResult({ ok: false, message: err.message || '读取配置失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig(true);
  }, [loadConfig]);

  const agentConfig = useMemo(
    () => config?.agents?.list?.find((entry: any) => entry.id === agentId),
    [agentId, config],
  );
  const identity = agentConfig?.identity || {};
  const displayName = identity.name || agentConfig?.name || agent?.name || agentId;
  const displayEmoji = identity.emoji || '🏛️';
  const displayTheme = identity.theme || 'slate';
  const displayAvatar = typeof identity.avatar === 'string' ? identity.avatar : '';
  const displayDescription = typeof identity.description === 'string' ? identity.description : '';
  const fallbackModel = agent?.model || agentConfig?.model || '';
  const agentTools = isRecord(agentConfig?.tools) ? agentConfig.tools : {};
  const agentRuntime = isRecord(agentConfig?.runtime) ? agentConfig.runtime : {};
  const agentRuntimeAcp = isRecord(agentRuntime.acp) ? agentRuntime.acp : {};
  const agentSubagents = isRecord(agentConfig?.subagents) ? agentConfig.subagents : {};
  const agentGroupChat = isRecord(agentConfig?.groupChat) ? agentConfig.groupChat : {};
  const modelOptions = useMemo(() => collectModelOptions(config), [config]);

  useEffect(() => {
    if (!agentConfig) return;
    setIdentityForm(buildIdentityForm(agentConfig, fallbackModel));
    setToolsForm(buildToolsForm(agentConfig));
    setAdvancedForm(buildAdvancedForm(agentConfig));
  }, [agentConfig, fallbackModel]);

  const agentSessions = Object.values(sessions)
    .filter((session) => session.agentId === agentId)
    .sort((left, right) => right.lastActivityTs - left.lastActivityTs);
  const activeSessions = agentSessions.filter((session) => session.status !== 'ended');

  const executeAction = useCallback(async (
    type: string,
    params: Record<string, unknown>,
    key: string,
    successMessage: string,
  ) => {
    setSavingKey(key);
    setActionResult(null);

    try {
      const response = await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params }),
      });
      const data = await response.json();

      if (!data.ok) {
        setActionResult({ ok: false, message: data.error || '操作失败' });
        return data;
      }

      setActionResult({ ok: true, message: data.message || successMessage });
      addEvent({
        id: `${type}-${Date.now()}`,
        type: 'info',
        message: successMessage,
        ts: Date.now(),
        agentId,
      });
      await loadConfig();
      return data;
    } catch (err: any) {
      setActionResult({ ok: false, message: err.message || '操作失败' });
      return { ok: false, error: err.message || '操作失败' };
    } finally {
      setSavingKey(null);
    }
  }, [addEvent, agentId, loadConfig]);

  const handleNewSession = useCallback(async () => {
    await executeAction(
      'session.new',
      { agentId, message: 'Hello from ClawCraft!' },
      `session:new:${agentId}`,
      `⚔️ 已为 ${displayName} 新建探险`,
    );
  }, [agentId, displayName, executeAction]);

  const handleSaveIdentity = useCallback(async () => {
    const updates = {
      model: identityForm.model.trim(),
      identity: {
        name: identityForm.name.trim(),
        emoji: identityForm.emoji.trim(),
        theme: identityForm.theme.trim(),
        avatar: identityForm.avatar.trim(),
        description: identityForm.description.trim(),
      },
    };

    const result = await executeAction(
      'agent.update',
      { agentId, updates },
      `agent:update:${agentId}`,
      `✏️ 已更新 ${displayName} 身份信息`,
    );

    if (result.ok) setEditing(false);
  }, [agentId, displayName, executeAction, identityForm]);

  const handleSaveTools = useCallback(async () => {
    const result = await executeAction(
      'agent.tools.update',
      {
        agentId,
        tools: {
          profile: toolsForm.profile || undefined,
          allow: textToList(toolsForm.allow),
          deny: textToList(toolsForm.deny),
          elevated: {
            enabled: toolsForm.elevatedEnabled,
          },
        },
      },
      `agent:tools:${agentId}`,
      `🛡️ 已更新 ${displayName} 工具权限`,
    );

    if (result.ok) setEditing(false);
  }, [agentId, displayName, executeAction, toolsForm]);

  const handleSaveAdvanced = useCallback(async () => {
    const runtimeType = advancedForm.runtimeType.trim() || 'default';
    const currentRuntime = isRecord(agentConfig?.runtime) ? agentConfig.runtime : {};
    const currentRuntimeAcp = isRecord(currentRuntime.acp) ? currentRuntime.acp : {};
    const currentSubagents = isRecord(agentConfig?.subagents) ? agentConfig.subagents : {};
    const currentGroupChat = isRecord(agentConfig?.groupChat) ? agentConfig.groupChat : {};

    const runtime: Record<string, unknown> = { ...currentRuntime, type: runtimeType };
    if (runtimeType === 'acp') {
      runtime.acp = {
        ...currentRuntimeAcp,
        agent: advancedForm.runtimeAcpAgent.trim(),
        backend: advancedForm.runtimeAcpBackend.trim(),
      };
    } else {
      delete runtime.acp;
    }

    const updates = {
      runtime,
      subagents: {
        ...currentSubagents,
        allowAgents: advancedForm.allowAgents,
      },
      groupChat: {
        ...currentGroupChat,
        mentionPatterns: advancedForm.mentionPatterns,
      },
    };

    const result = await executeAction(
      'agent.update',
      { agentId, updates },
      `agent:advanced:${agentId}`,
      `🧭 已更新 ${displayName} 运行时与路由配置`,
    );

    if (result.ok) setEditing(false);
  }, [advancedForm, agentConfig, agentId, displayName, executeAction]);

  const handleSessionAction = useCallback(async (
    type: 'session.compact' | 'session.reset',
    sessionKey: string,
  ) => {
    const shortKey = `${sessionKey.slice(0, 8)}...`;
    const confirmed = type === 'session.compact'
      ? confirm(`确认压缩会话 ${shortKey} 吗？\n这会触发 OpenClaw compact。`)
      : confirm(`⚠️ 确认重置会话 ${shortKey} 吗？\n上下文会被清空，文案比 compact 更严重。`);

    if (!confirmed) return;

    await executeAction(
      type,
      { sessionKey, agentId },
      `${type}:${sessionKey}`,
      type === 'session.compact' ? `🗜️ 已触发 ${shortKey} compact` : `🗑️ 已触发 ${shortKey} reset`,
    );
  }, [agentId, executeAction]);

  const currentProfile = typeof agentTools.profile === 'string' ? agentTools.profile : '未设置';
  const currentAllow = listToText(agentTools.allow) || '无';
  const currentDeny = listToText(agentTools.deny) || '无';
  const elevatedEnabled = Boolean(agentTools.elevated?.enabled);
  const runtimeType = typeof agentRuntime.type === 'string' ? agentRuntime.type : 'default';
  const runtimeAgent = typeof agentRuntimeAcp.agent === 'string' ? agentRuntimeAcp.agent : '未设置';
  const runtimeBackend = typeof agentRuntimeAcp.backend === 'string' ? agentRuntimeAcp.backend : '未设置';
  const allowAgentsText = listToText(agentSubagents.allowAgents) || '无';
  const mentionPatternsText = listToText(agentGroupChat.mentionPatterns) || '无';

  return (
    <div className="w-full rounded-2xl border border-slate-700/50 bg-slate-950/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/40 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">{displayEmoji}</span>
          <h2 className="text-base font-bold text-slate-100">{displayName}</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            agent ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-500'
          }`}>
            {agent ? '在线' : '离线'}
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-200">✕</button>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4 scrollbar-thin">
        {loading ? (
          <div className="py-8 text-center text-slate-500">⏳ 加载中...</div>
        ) : (
          <>
            {modelOptions.length > 0 && (
              <datalist id={`agent-model-options-${agentId}`}>
                {modelOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            )}

            <div className="space-y-3 rounded-xl border border-slate-700/30 p-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {displayAvatar ? (
                    <img
                      src={displayAvatar}
                      alt={displayName}
                      className="h-14 w-14 rounded-2xl border border-slate-700/60 object-cover"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/60 text-2xl">
                      {displayEmoji}
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-100">{displayEmoji} {displayName}</p>
                    <p className="text-[11px] text-slate-500">{agentId}</p>
                    {displayDescription && (
                      <p className="max-w-[250px] rounded-lg bg-slate-950/60 px-2.5 py-2 text-[11px] leading-relaxed text-slate-300">
                        {displayDescription}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setEditing((current) => !current);
                    setIdentityForm(buildIdentityForm(agentConfig, fallbackModel));
                    setToolsForm(buildToolsForm(agentConfig));
                    setAdvancedForm(buildAdvancedForm(agentConfig));
                  }}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20"
                >
                  {editing ? '收起编辑' : '✏️ 编辑'}
                </button>
              </div>

              <div className="space-y-1.5 rounded-lg bg-slate-950/60 px-3 py-2">
                <InfoRow label="模型" value={fallbackModel || '默认'} />
                <InfoRow label="Theme" value={displayTheme} />
                <InfoRow label="Avatar" value={displayAvatar || '未设置'} />
                <InfoRow label="工具 Profile" value={currentProfile} />
                <InfoRow label="Allow" value={currentAllow} />
                <InfoRow label="Deny" value={currentDeny} />
                <InfoRow label="Elevated" value={elevatedEnabled ? 'enabled' : 'disabled'} />
                <InfoRow label="Runtime" value={runtimeType} />
                {runtimeType === 'acp' && <InfoRow label="ACP" value={`${runtimeAgent} / ${runtimeBackend}`} />}
                <InfoRow label="Allow Agents" value={allowAgentsText} />
                <InfoRow label="Mention Patterns" value={mentionPatternsText} />
                {agentConfig?.workspace && <InfoRow label="工作区" value={agentConfig.workspace} />}
                <InfoRow label="会话数" value={`${activeSessions.length} 活跃 / ${agentSessions.length} 总计`} />
              </div>

              {editing && (
                <div className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-950/70 p-3">
                  <div className="space-y-3">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-400">Identity</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field className="sm:col-span-2" label="模型">
                        <Input
                          list={`agent-model-options-${agentId}`}
                          value={identityForm.model}
                          onChange={(event) => setIdentityForm((prev) => ({ ...prev, model: event.target.value }))}
                          placeholder="provider/model-name"
                        />
                      </Field>
                      <Field label="显示名">
                        <Input
                          value={identityForm.name}
                          onChange={(event) => setIdentityForm((prev) => ({ ...prev, name: event.target.value }))}
                          placeholder="Ottor"
                        />
                      </Field>
                      <Field label="Emoji">
                        <Input
                          value={identityForm.emoji}
                          onChange={(event) => setIdentityForm((prev) => ({ ...prev, emoji: event.target.value }))}
                          placeholder="🔬"
                        />
                      </Field>
                      <Field className="sm:col-span-2" label="Theme">
                        <Input
                          value={identityForm.theme}
                          onChange={(event) => setIdentityForm((prev) => ({ ...prev, theme: event.target.value }))}
                          placeholder="slate / amber / sky"
                        />
                      </Field>
                      <Field className="sm:col-span-2" label="Avatar">
                        <Input
                          value={identityForm.avatar}
                          onChange={(event) => setIdentityForm((prev) => ({ ...prev, avatar: event.target.value }))}
                          placeholder="https://... or /path/to/avatar.png"
                        />
                      </Field>
                      <Field className="sm:col-span-2" label="Description">
                        <Textarea
                          value={identityForm.description}
                          onChange={(event) => setIdentityForm((prev) => ({ ...prev, description: event.target.value }))}
                          rows={4}
                          placeholder="Agent description"
                        />
                      </Field>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => {
                          void handleSaveIdentity();
                        }}
                        disabled={savingKey === `agent:update:${agentId}`}
                        className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                      >
                        {savingKey === `agent:update:${agentId}` ? '⏳ 保存中...' : '💾 保存身份'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-slate-800/80 pt-4">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-sky-400">Tools</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="tools.profile">
                        <Select
                          value={toolsForm.profile}
                          onChange={(event) => setToolsForm((prev) => ({ ...prev, profile: event.target.value }))}
                        >
                          <option value="">未设置</option>
                          <option value="minimal">minimal</option>
                          <option value="coding">coding</option>
                          <option value="messaging">messaging</option>
                          <option value="full">full</option>
                        </Select>
                      </Field>
                      <ToggleField
                        label="tools.elevated.enabled"
                        checked={toolsForm.elevatedEnabled}
                        onChange={(checked) => setToolsForm((prev) => ({ ...prev, elevatedEnabled: checked }))}
                      />
                      <Field className="sm:col-span-2" label="tools.allow">
                        <Input
                          value={toolsForm.allow}
                          onChange={(event) => setToolsForm((prev) => ({ ...prev, allow: event.target.value }))}
                          placeholder="exec, web, sessions_send"
                        />
                      </Field>
                      <Field className="sm:col-span-2" label="tools.deny">
                        <Input
                          value={toolsForm.deny}
                          onChange={(event) => setToolsForm((prev) => ({ ...prev, deny: event.target.value }))}
                          placeholder="browser, gateway"
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-slate-800/80 pt-4">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-400">Runtime & Routing</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="runtime.type">
                        <Select
                          value={advancedForm.runtimeType}
                          onChange={(event) => setAdvancedForm((prev) => ({ ...prev, runtimeType: event.target.value }))}
                        >
                          <option value="default">default</option>
                          <option value="acp">acp</option>
                        </Select>
                      </Field>
                      <div />
                      {advancedForm.runtimeType === 'acp' && (
                        <>
                          <Field label="runtime.acp.agent">
                            <Input
                              value={advancedForm.runtimeAcpAgent}
                              onChange={(event) => setAdvancedForm((prev) => ({ ...prev, runtimeAcpAgent: event.target.value }))}
                              placeholder="codex"
                            />
                          </Field>
                          <Field label="runtime.acp.backend">
                            <Input
                              value={advancedForm.runtimeAcpBackend}
                              onChange={(event) => setAdvancedForm((prev) => ({ ...prev, runtimeAcpBackend: event.target.value }))}
                              placeholder="acpx"
                            />
                          </Field>
                        </>
                      )}
                      <Field className="sm:col-span-2" label="subagents.allowAgents">
                        <ChipInput
                          values={advancedForm.allowAgents}
                          onChange={(values) => setAdvancedForm((prev) => ({ ...prev, allowAgents: values }))}
                          placeholder="输入 agent id 后按 Enter，例如 research"
                        />
                      </Field>
                      <Field className="sm:col-span-2" label="groupChat.mentionPatterns">
                        <ChipInput
                          values={advancedForm.mentionPatterns}
                          onChange={(values) => setAdvancedForm((prev) => ({ ...prev, mentionPatterns: values }))}
                          placeholder="输入 mention regex 后按 Enter，例如 @openclaw"
                        />
                      </Field>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => {
                          void handleSaveAdvanced();
                        }}
                        disabled={savingKey === `agent:advanced:${agentId}`}
                        className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
                      >
                        {savingKey === `agent:advanced:${agentId}` ? '⏳ 保存中...' : '💾 保存运行时配置'}
                      </button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => {
                          void handleSaveTools();
                        }}
                        disabled={savingKey === `agent:tools:${agentId}`}
                        className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                      >
                        {savingKey === `agent:tools:${agentId}` ? '⏳ 保存中...' : '💾 保存工具权限'}
                      </button>
                      <button
                        onClick={() => {
                          setEditing(false);
                          setIdentityForm(buildIdentityForm(agentConfig, fallbackModel));
                          setToolsForm(buildToolsForm(agentConfig));
                          setAdvancedForm(buildAdvancedForm(agentConfig));
                        }}
                        className="rounded-lg border border-slate-700/60 px-3 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-slate-700/30 bg-slate-900/30 p-3">
              <div>
                <p className="text-sm font-medium text-slate-100">默认行为</p>
                <p className="text-[11px] text-slate-500">这些配置来自 Gateway 级默认值，但已直接并入 Agent 管理界面。</p>
              </div>

              <CollapsibleSection icon="💓" title="心跳" subtitle="agents.defaults.heartbeat">
                <HeartbeatForm config={config} onConfigRefresh={loadConfig} />
              </CollapsibleSection>

              <CollapsibleSection icon="🗜️" title="压缩" subtitle="agents.defaults.compaction">
                <CompactionForm config={config} onConfigRefresh={loadConfig} />
              </CollapsibleSection>

              <CollapsibleSection icon="🔄" title="会话" subtitle="session">
                <SessionForm config={config} onConfigRefresh={loadConfig} />
              </CollapsibleSection>
            </div>

            {activeSessions.length > 0 && (
              <div>
                <h4 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-slate-500">活跃会话</h4>
                <div className="space-y-3">
                  {activeSessions.map((session) => {
                    const compactKey = `session.compact:${session.sessionKey}`;
                    const resetKey = `session.reset:${session.sessionKey}`;
                    return (
                      <div key={session.sessionKey} className="space-y-3 rounded-lg border border-slate-700/30 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="space-y-1">
                            <span className="font-mono text-[11px] text-slate-300">{session.sessionKey.slice(0, 8)}...</span>
                            <p className="text-[10px] text-slate-500">最后活动: {new Date(session.lastActivityTs).toLocaleTimeString()}</p>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            session.status === 'responding' ? 'bg-sky-500/20 text-sky-400' :
                            session.status === 'thinking' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-slate-700/50 text-slate-500'
                          }`}>
                            {session.status}
                          </span>
                        </div>

                        {(session as any).lastTool && (
                          <p className="text-[10px] text-slate-600">🔧 {(session as any).lastTool}</p>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              void handleSessionAction('session.compact', session.sessionKey);
                            }}
                            disabled={savingKey === compactKey}
                            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
                          >
                            {savingKey === compactKey ? '⏳ Compact 中' : '🗜️ Compact'}
                          </button>
                          <button
                            onClick={() => {
                              void handleSessionAction('session.reset', session.sessionKey);
                            }}
                            disabled={savingKey === resetKey}
                            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                          >
                            {savingKey === resetKey ? '⏳ Reset 中' : '🗑️ Reset'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={() => {
                void handleNewSession();
              }}
              disabled={savingKey === `session:new:${agentId}`}
              className="w-full rounded-xl border border-sky-500/30 bg-sky-500/10 py-2.5 text-sm font-medium text-sky-400 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
            >
              {savingKey === `session:new:${agentId}` ? '⏳ 创建中...' : '⚔️ 新建探险'}
            </button>

            {actionResult && (
              <div className={`rounded-lg px-3 py-2 text-xs ${actionResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                {actionResult.ok ? '✅' : '❌'} {actionResult.message}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="block text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="break-all text-right font-mono text-[11px] text-slate-300">{value}</span>
    </div>
  );
}

function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-[110px] w-full rounded-2xl border border-slate-700/80 bg-slate-950/65 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/50 ${className}`}
      {...props}
    />
  );
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className="h-11 w-full rounded-2xl border border-slate-700/80 bg-slate-950/65 px-4 text-sm text-slate-100 outline-none focus:border-sky-400/50"
      {...props}
    />
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-700/30 bg-slate-950/45 px-3 py-2 text-xs text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-600 bg-slate-950"
      />
      <span>{label}</span>
    </label>
  );
}

function ChipInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');

  const commitDraft = useCallback(() => {
    const next = draft.trim();
    if (!next) return;
    if (values.includes(next)) {
      setDraft('');
      return;
    }
    onChange([...values, next]);
    setDraft('');
  }, [draft, onChange, values]);

  return (
    <div className="space-y-2 rounded-2xl border border-slate-700/80 bg-slate-950/65 px-3 py-3">
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/90 px-2.5 py-1 text-[11px] text-slate-200">
            <span className="font-mono">{value}</span>
            <button
              type="button"
              onClick={() => onChange(values.filter((entry) => entry !== value))}
              className="text-slate-500 transition-colors hover:text-red-300"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commitDraft();
          } else if (event.key === 'Backspace' && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commitDraft}
        placeholder={placeholder}
      />
      <p className="text-[10px] text-slate-500">按 Enter 或逗号加入，点 × 删除</p>
    </div>
  );
}

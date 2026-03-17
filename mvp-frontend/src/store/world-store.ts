import { create } from 'zustand';
import { soundManager } from '@/audio/sound-manager';
import type {
  AgentState,
  ChannelStatus,
  ChatMessage,
  EntityType,
  GatewayStatus,
  Incident,
  KingdomBuilding,
  OnboardingProgress,
  OvernightSummary,
  SSEEvent,
  ServerDelta,
  SessionState,
  UnitCardTab,
  WorldState,
} from '@/store/types';

// ── Chat persistence via localStorage ──
const CHAT_STORAGE_KEY = 'clawcraft:chat';
const CHAT_MAX_PERSISTED_MESSAGES = 200;

interface PersistedChat {
  sessionKey: string | null;
  targetAgent: string;
  messages: ChatMessage[];
  savedAt: number;
}

function loadPersistedChat(): Partial<PersistedChat> {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as PersistedChat;
    // Discard stale data older than 24h
    if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(CHAT_STORAGE_KEY);
      return {};
    }
    return data;
  } catch {
    return {};
  }
}

function persistChat(sessionKey: string | null, targetAgent: string, messages: ChatMessage[]) {
  try {
    const data: PersistedChat = {
      sessionKey,
      targetAgent,
      messages: messages.slice(-CHAT_MAX_PERSISTED_MESSAGES),
      savedAt: Date.now(),
    };
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

function clearPersistedChat() {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {}
}

export interface WorldStore {
  connected: boolean;
  serverInstanceId: string | null;
  version: string | null;
  reconnectAttempt: number;
  agents: Record<string, AgentState>;
  sessions: Record<string, SessionState>;
  gatewayStatus: GatewayStatus;
  channels: Record<string, ChannelStatus>;
  buildings: KingdomBuilding[];
  incidents: Incident[];
  overnightSummary: OvernightSummary | null;
  onboardingProgress: OnboardingProgress | null;
  selectedEntityId: string | null;
  selectedEntityType: EntityType | null;
  developerMode: boolean;
  unitCardTab: UnitCardTab;
  recentEvents: SSEEvent[];
  chatSessionKey: string | null;
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  chatStreamingText: string;
  chatError: string | null;
  chatStreamController: AbortController | null;
  chatFocusNonce: number;
  agentActivity: Record<string, { status: 'idle' | 'thinking' | 'tooling'; since: number }>;
  muted: boolean;
  resetWorld: () => void;
  setFullState: (state: WorldState) => void;
  applyDelta: (delta: ServerDelta) => void;
  selectEntity: (id: string, type: EntityType, options?: { tab?: UnitCardTab }) => void;
  panTo: (id: string, type: EntityType) => void;
  clearSelection: () => void;
  setUnitCardTab: (tab: UnitCardTab) => void;
  toggleDeveloperMode: () => void;
  addEvent: (event: SSEEvent) => void;
  setConnected: (connected: boolean, instanceId?: string | null, reconnectAttempt?: number) => void;
  setReconnectAttempt: (attempt: number) => void;
  sendMessage: (message: string) => Promise<void>;
  loadChatHistory: (sessionKey: string) => Promise<void>;
  abortChatStream: () => void;
  startNewChatSession: () => void;
  setChatSessionKey: (sessionKey: string | null) => void;
  requestChatFocus: () => void;
  toggleMuted: () => void;
  chatDrawerOpen: boolean;
  activityPanelOpen: boolean;
  chatTargetAgent: string;
  setChatDrawerOpen: (open: boolean) => void;
  setActivityPanelOpen: (open: boolean) => void;
  setChatTargetAgent: (agentId: string) => void;
}

const _persistedChat = loadPersistedChat();

const initialState = {
  connected: false,
  serverInstanceId: null,
  version: null,
  reconnectAttempt: 0,
  agents: {} as Record<string, AgentState>,
  sessions: {} as Record<string, SessionState>,
  gatewayStatus: 'unknown' as GatewayStatus,
  channels: {} as Record<string, ChannelStatus>,
  buildings: [] as KingdomBuilding[],
  incidents: [] as Incident[],
  overnightSummary: null as OvernightSummary | null,
  onboardingProgress: null as OnboardingProgress | null,
  selectedEntityId: null,
  selectedEntityType: null as EntityType | null,
  developerMode: false,
  unitCardTab: 'overview' as UnitCardTab,
  recentEvents: [] as SSEEvent[],
  chatSessionKey: _persistedChat.sessionKey ?? null,
  chatMessages: (_persistedChat.messages ?? []) as ChatMessage[],
  chatLoading: false,
  chatStreamingText: '',
  chatError: null as string | null,
  chatStreamController: null as AbortController | null,
  chatFocusNonce: 0,
  agentActivity: {} as Record<string, { status: 'idle' | 'thinking' | 'tooling'; since: number }>,
  muted: false,
  chatDrawerOpen: false,
  activityPanelOpen: false,
  chatTargetAgent: _persistedChat.targetAgent ?? 'main',
};

function makeEvent(input: Omit<SSEEvent, 'id'>): SSEEvent {
  return {
    id: `event-${input.ts}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  };
}

function summarizeDelta(delta: ServerDelta, agents: Record<string, AgentState>, sessions: Record<string, SessionState>): SSEEvent | null {
  if (delta.type === 'event') {
    return makeEvent({
      type: delta.event.type === 'info' ? 'info' : delta.event.type,
      message: delta.event.message,
      ts: delta.event.ts,
      agentId: delta.event.agentId,
      sessionKey: delta.event.sessionKey,
    });
  }

  if (delta.type === 'session-created') {
    const agent = agents[delta.session.agentId];
    return makeEvent({
      type: 'info',
      message: `${agent?.name ?? delta.session.agentId} opened a new session.`,
      ts: delta.session.lastActivityTs,
      agentId: delta.session.agentId,
      sessionKey: delta.session.sessionKey,
    });
  }

  if (delta.type === 'chat-message' && delta.message.role === 'assistant') {
    return makeEvent({
      type: 'complete',
      message: `Reply ready for ${truncate(delta.sessionKey)}.`,
      ts: delta.message.timestamp,
      sessionKey: delta.sessionKey,
    });
  }

  if (delta.type !== 'session-update') {
    return null;
  }

  const nextStatus = delta.changes.status;
  const session = sessions[delta.sessionKey];
  const agent = session ? agents[session.agentId] : undefined;

  if (nextStatus === 'thinking') {
    return makeEvent({
      type: 'thinking',
      message: `${agent?.name ?? session?.agentId ?? 'Agent'} is thinking.`,
      ts: Date.now(),
      agentId: session?.agentId,
      sessionKey: delta.sessionKey,
    });
  }

  if (nextStatus === 'tooling') {
    return makeEvent({
      type: 'tool',
      message: `${agent?.name ?? session?.agentId ?? 'Agent'} is using ${delta.changes.currentTool ?? 'a tool'}.`,
      ts: Date.now(),
      agentId: session?.agentId,
      sessionKey: delta.sessionKey,
      toolName: delta.changes.currentTool ?? undefined,
    });
  }

  if (nextStatus === 'idle' && delta.changes.lastAssistantPreview) {
    return makeEvent({
      type: 'complete',
      message: `${agent?.name ?? session?.agentId ?? 'Agent'} finished a run.`,
      ts: Date.now(),
      agentId: session?.agentId,
      sessionKey: delta.sessionKey,
    });
  }

  if (nextStatus === 'ended') {
    return makeEvent({
      type: 'info',
      message: `${truncate(delta.sessionKey)} ended.`,
      ts: Date.now(),
      agentId: session?.agentId,
      sessionKey: delta.sessionKey,
    });
  }

  return null;
}

function truncate(value: string, size = 18) {
  return value.length > size ? `${value.slice(0, size - 1)}…` : value;
}

function resolveChatSession(entityId: string, type: EntityType, state: Pick<WorldStore, 'agents' | 'sessions'>) {
  if (type === 'session') {
    return entityId;
  }

  if (type === 'agent') {
    const agent = state.agents[entityId];
    if (!agent?.sessionKeys?.length) {
      return null;
    }

    const sessions = agent.sessionKeys
      .map((sessionKey) => state.sessions[sessionKey])
      .filter(Boolean)
      .sort((a, b) => (b?.lastActivityTs ?? 0) - (a?.lastActivityTs ?? 0));

    return sessions[0]?.sessionKey ?? null;
  }

  return null;
}

function resolveChatSessionForAgent(agentId: string, state: Pick<WorldStore, 'agents' | 'sessions'>) {
  return resolveChatSession(agentId, 'agent', state);
}

function normalizeAgentActivityStatus(status: SessionState['status'] | undefined): 'idle' | 'thinking' | 'tooling' {
  if (status === 'tooling') {
    return 'tooling';
  }

  if (status === 'thinking' || status === 'responding' || status === 'blocked') {
    return 'thinking';
  }

  return 'idle';
}

function getAgentActivityPriority(status: 'idle' | 'thinking' | 'tooling') {
  if (status === 'tooling') {
    return 2;
  }

  if (status === 'thinking') {
    return 1;
  }

  return 0;
}

function deriveAgentActivity(
  agents: Record<string, AgentState>,
  sessions: Record<string, SessionState>,
  previous: WorldStore['agentActivity'] = {},
) {
  const now = Date.now();
  const agentIds = new Set<string>([
    ...Object.keys(agents),
    ...Object.values(sessions).map((session) => session.agentId),
    ...Object.keys(previous),
  ]);

  const next: WorldStore['agentActivity'] = {};
  for (const agentId of agentIds) {
    const previousEntry = previous[agentId];
    next[agentId] = {
      status: 'idle',
      since: previousEntry?.status === 'idle' ? previousEntry.since : now,
    };
  }

  for (const session of Object.values(sessions)) {
    const agentId = session.agentId;
    const normalizedStatus = normalizeAgentActivityStatus(session.status);
    const current = next[agentId] ?? { status: 'idle', since: now };
    const currentPriority = getAgentActivityPriority(current.status);
    const nextPriority = getAgentActivityPriority(normalizedStatus);
    const since = session.lastActivityTs || now;

    if (nextPriority > currentPriority) {
      next[agentId] = { status: normalizedStatus, since };
      continue;
    }

    if (nextPriority === currentPriority && normalizedStatus !== 'idle') {
      next[agentId] = {
        status: normalizedStatus,
        since: Math.min(current.since, since),
      };
    }
  }

  for (const [agentId, entry] of Object.entries(next)) {
    const previousEntry = previous[agentId];
    if (!previousEntry) {
      continue;
    }

    if (previousEntry.status === entry.status) {
      next[agentId] = { ...entry, since: previousEntry.since };
    }
  }

  return next;
}

function replaceMessageSessionKey(messages: ChatMessage[], fromSessionKey: string, toSessionKey: string) {
  if (!fromSessionKey || fromSessionKey === toSessionKey) {
    return messages;
  }

  return messages.map((message) =>
    message.sessionKey === fromSessionKey ? { ...message, sessionKey: toSessionKey } : message,
  );
}

export const useWorldStore = create<WorldStore>((set, get) => ({
  ...initialState,
  resetWorld: () =>
    set((state) => {
      clearPersistedChat();
      return {
        ...initialState,
        developerMode: state.developerMode,
        muted: state.muted,
        // Reset chat on world reset (new server instance)
        chatSessionKey: null,
        chatMessages: [],
      };
    }),
  setFullState: (state) =>
    set((current) => {
      const selectedExists =
        current.selectedEntityType === 'gateway' ||
        (current.selectedEntityType === 'agent' && Boolean(state.agents[current.selectedEntityId ?? ''])) ||
        (current.selectedEntityType === 'session' && Boolean(state.sessions[current.selectedEntityId ?? '']));

      // Preserve chat context if we have an active session with messages or ongoing stream
      const hasActiveChat = current.chatSessionKey && (current.chatMessages.length > 0 || current.chatLoading || current.chatStreamingText);
      const nextChatTargetAgent =
        current.chatTargetAgent && (state.agents?.[current.chatTargetAgent] || current.chatTargetAgent === 'main')
          ? current.chatTargetAgent
          : Object.keys(state.agents ?? {})[0] ?? 'main';

      return {
        agents: state.agents ?? {},
        sessions: state.sessions ?? {},
        gatewayStatus: state.gatewayStatus ?? 'unknown',
        channels: state.channels ?? {},
        buildings: state.buildings ?? [],
        incidents: state.incidents ?? [],
        overnightSummary: state.overnightSummary ?? null,
        onboardingProgress: state.onboardingProgress ?? null,
        serverInstanceId: state.serverInstanceId ?? current.serverInstanceId,
        version: state.version ?? current.version,
        selectedEntityId: selectedExists ? current.selectedEntityId : null,
        selectedEntityType: selectedExists ? current.selectedEntityType : null,
        chatTargetAgent: nextChatTargetAgent,
        // Keep the current chat session and messages if user has an active conversation
        chatSessionKey: hasActiveChat
          ? current.chatSessionKey
          : (selectedExists && current.selectedEntityId && current.selectedEntityType
              ? resolveChatSession(current.selectedEntityId, current.selectedEntityType, {
                  agents: state.agents ?? {},
                  sessions: state.sessions ?? {},
                })
              : resolveChatSessionForAgent(nextChatTargetAgent, {
                  agents: state.agents ?? {},
                  sessions: state.sessions ?? {},
                })),
        // Never clear chatMessages on state refresh
        chatMessages: current.chatMessages,
        agentActivity: deriveAgentActivity(state.agents ?? {}, state.sessions ?? {}, current.agentActivity),
      };
    }),
  applyDelta: (delta) =>
    set((state) => {
      const nextAgents = { ...state.agents };
      const nextSessions = { ...state.sessions };
      let nextChatMessages = state.chatMessages;
      let nextIncidents = state.incidents;

      if (delta.type === 'session-created') {
        nextSessions[delta.session.sessionKey] = delta.session;
        const agent = nextAgents[delta.session.agentId];
        if (agent) {
          nextAgents[delta.session.agentId] = {
            ...agent,
            sessionKeys: Array.from(new Set([...agent.sessionKeys, delta.session.sessionKey])),
          };
        }
      }

      if (delta.type === 'session-update') {
        const currentSession = nextSessions[delta.sessionKey];
        if (currentSession) {
          nextSessions[delta.sessionKey] = {
            ...currentSession,
            ...delta.changes,
            currentTool: delta.changes.currentTool === null ? undefined : delta.changes.currentTool ?? currentSession.currentTool,
            currentToolCategory:
              delta.changes.currentToolCategory === null
                ? undefined
                : delta.changes.currentToolCategory ?? currentSession.currentToolCategory,
            lastActivityTs: Date.now(),
          };
        }
      }

      if (delta.type === 'chat-message') {
        const message: ChatMessage = {
          id: delta.message.id ?? `chat-${delta.message.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          sessionKey: delta.sessionKey,
          role: delta.message.role,
          content: delta.message.content,
          timestamp: delta.message.timestamp,
          toolName: delta.message.toolName,
        };

        // Match current session OR any session from the same target agent (for pending sessions)
        const matchesCurrent = state.chatSessionKey === delta.sessionKey;
        const matchesTargetAgent = !matchesCurrent && state.chatTargetAgent &&
          state.sessions[delta.sessionKey]?.agentId === state.chatTargetAgent;

        if (matchesCurrent || matchesTargetAgent) {
          nextChatMessages = dedupeMessages([...state.chatMessages, message]);
        }
      }

      if (delta.type === 'incident-created') {
        nextIncidents = [...state.incidents.filter(i => i.id !== delta.incident.id), delta.incident];
      }

      if (delta.type === 'incident-updated') {
        nextIncidents = state.incidents.map(i =>
          i.id === delta.id ? { ...i, ...delta.changes } : i
        );
      }

      const event = summarizeDelta(delta, nextAgents, nextSessions);
      const recentEvents = event ? [event, ...state.recentEvents].slice(0, 5) : state.recentEvents;

      if (event) {
        if (event.type === 'error') {
          soundManager.play('error');
        } else if (event.type === 'complete') {
          soundManager.play('complete');
        } else {
          soundManager.play('event');
        }
      }

      // Don't override chatSessionKey during active send/stream — it would disrupt the conversation
      const isActivelyChatting = state.chatLoading || state.chatStreamController || state.chatStreamingText;
      const nextChatSessionKey = isActivelyChatting
        ? state.chatSessionKey
        : state.selectedEntityType === 'session' && state.selectedEntityId
          ? state.selectedEntityId
          : state.chatTargetAgent
            ? resolveChatSessionForAgent(state.chatTargetAgent, { agents: nextAgents, sessions: nextSessions })
            : state.chatSessionKey;

      return {
        agents: nextAgents,
        sessions: nextSessions,
        chatMessages: nextChatMessages,
        incidents: nextIncidents,
        recentEvents,
        chatSessionKey: nextChatSessionKey,
        agentActivity: deriveAgentActivity(nextAgents, nextSessions, state.agentActivity),
      };
    }),
  selectEntity: (id, type, options) =>
    set((state) => {
      const nextChatTargetAgent =
        type === 'agent'
          ? id
          : type === 'session'
            ? state.sessions[id]?.agentId ?? state.chatTargetAgent
            : state.chatTargetAgent;

      return {
        selectedEntityId: id,
        selectedEntityType: type,
        unitCardTab: options?.tab ?? 'overview',
        chatTargetAgent: nextChatTargetAgent,
        chatDrawerOpen: type === 'agent' ? true : state.chatDrawerOpen,
        chatSessionKey:
          type === 'agent' || type === 'session'
            ? resolveChatSession(id, type, state)
            : resolveChatSessionForAgent(nextChatTargetAgent, state),
      };
    }),
  panTo: (id, type) => {
    if (typeof window === 'undefined') {
      return;
    }

    (window as any).__panToEntity?.(id, type);
  },
  clearSelection: () =>
    set({
      selectedEntityId: null,
      selectedEntityType: null,
      unitCardTab: 'overview',
    }),
  setUnitCardTab: (tab) => set({ unitCardTab: tab }),
  toggleDeveloperMode: () => set((state) => ({ developerMode: !state.developerMode })),
  addEvent: (event) =>
    set((state) => ({
      recentEvents: [event, ...state.recentEvents].slice(0, 5),
    })),
  setConnected: (connected, instanceId, reconnectAttempt = 0) =>
    set((state) => ({
      connected,
      reconnectAttempt,
      serverInstanceId: instanceId ?? state.serverInstanceId,
    })),
  setReconnectAttempt: (reconnectAttempt) => set({ reconnectAttempt }),
  sendMessage: async (message) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const { chatSessionKey, chatTargetAgent } = get();
    if (!chatTargetAgent) {
      return;
    }

    const sentAt = Date.now();
    const pendingSessionKey = chatSessionKey ?? `pending:${chatTargetAgent}:${sentAt}`;
    const clientMessageId = `local-user-${sentAt}`;
    const clientTimestamp = sentAt;
    const controller = new AbortController();

    const optimisticMessage: ChatMessage = {
      id: clientMessageId,
      sessionKey: pendingSessionKey,
      role: 'user',
      content: trimmed,
      timestamp: clientTimestamp,
    };

    set((state) => ({
      chatLoading: true,
      chatStreamingText: '',
      chatError: null,
      chatStreamController: controller,
      chatMessages: dedupeMessages([...state.chatMessages, optimisticMessage]),
    }));

    let activeSessionKey = pendingSessionKey;
    let assistantMessageId = `stream-assistant-${sentAt}`;
    let assistantTimestamp = sentAt;
    let streamingText = '';

    try {
      const response = await fetch('/clawcraft/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          sessionKey: chatSessionKey,
          agentId: chatTargetAgent,
          message: trimmed,
          stream: true,
          clientMessageId,
          clientTimestamp,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message (${response.status})`);
      }

      if (!response.body) {
        throw new Error('Streaming response is unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const applySessionMetadata = (sessionKey: string) => {
        if (!sessionKey || sessionKey === activeSessionKey) {
          return;
        }

        const previousSessionKey = activeSessionKey;
        activeSessionKey = sessionKey;

        set((state) => ({
          chatSessionKey: sessionKey,
          chatMessages: replaceMessageSessionKey(state.chatMessages, previousSessionKey, sessionKey),
        }));
      };

      const finalizeStreamingMessage = (content: string) => {
        const finalContent = content.trimEnd();
        set((state) => {
          const nextMessagesBase = activeSessionKey.startsWith('pending:')
            ? state.chatMessages
            : replaceMessageSessionKey(state.chatMessages, pendingSessionKey, activeSessionKey);

          const nextMessages = finalContent
            ? dedupeMessages([
                ...nextMessagesBase,
                {
                  id: assistantMessageId,
                  sessionKey: activeSessionKey,
                  role: 'assistant',
                  content: finalContent,
                  timestamp: assistantTimestamp,
                },
              ])
            : nextMessagesBase;

          const resolvedSessionKey = activeSessionKey.startsWith('pending:') ? state.chatSessionKey : activeSessionKey;
          // Persist after message finalized
          persistChat(resolvedSessionKey, state.chatTargetAgent, nextMessages);

          return {
            chatLoading: false,
            chatStreamingText: '',
            chatError: null,
            chatStreamController: null,
            chatSessionKey: resolvedSessionKey,
            chatMessages: nextMessages,
          };
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue;
          }

          const data = line.slice(5).trimStart();
          if (!data) {
            continue;
          }

          if (data === '[DONE]') {
            finalizeStreamingMessage(streamingText);
            return;
          }

          try {
            const payload = JSON.parse(data);

            if (payload?.error) {
              throw new Error(String(payload.error));
            }

            if (typeof payload?.sessionKey === 'string' && payload.sessionKey) {
              applySessionMetadata(payload.sessionKey);
            }

            if (typeof payload?.assistantMessageId === 'string' && payload.assistantMessageId) {
              assistantMessageId = payload.assistantMessageId;
            }

            if (typeof payload?.assistantTimestamp === 'number' && Number.isFinite(payload.assistantTimestamp)) {
              assistantTimestamp = payload.assistantTimestamp;
            }

            const delta =
              typeof payload?.content === 'string'
                ? payload.content
                : typeof payload?.choices?.[0]?.delta?.content === 'string'
                  ? payload.choices[0].delta.content
                  : '';

            if (!delta) {
              continue;
            }

            streamingText += delta;
            set((state) => ({
              chatStreamingText: streamingText,
              chatError: null,
              chatSessionKey: activeSessionKey.startsWith('pending:') ? state.chatSessionKey : activeSessionKey,
            }));
          } catch (error) {
            if (error instanceof Error) {
              throw error;
            }
          }
        }

        if (done) {
          if (buffer.trim() === 'data: [DONE]' || streamingText) {
            finalizeStreamingMessage(streamingText);
            return;
          }

          throw new Error('Streaming response ended unexpectedly');
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        set((state) => {
          const nextMessagesBase = activeSessionKey.startsWith('pending:')
            ? state.chatMessages
            : replaceMessageSessionKey(state.chatMessages, pendingSessionKey, activeSessionKey);

          const nextMessages = streamingText.trim()
            ? dedupeMessages([
                ...nextMessagesBase,
                {
                  id: assistantMessageId,
                  sessionKey: activeSessionKey,
                  role: 'assistant',
                  content: streamingText.trimEnd(),
                  timestamp: assistantTimestamp,
                },
              ])
            : nextMessagesBase;

          const resolvedSessionKey = activeSessionKey.startsWith('pending:') ? state.chatSessionKey : activeSessionKey;
          persistChat(resolvedSessionKey, state.chatTargetAgent, nextMessages);

          return {
            chatLoading: false,
            chatStreamingText: '',
            chatError: null,
            chatStreamController: null,
            chatSessionKey: resolvedSessionKey,
            chatMessages: nextMessages,
          };
        });
        return;
      }

      const messageText = error instanceof Error ? error.message : 'Failed to send chat message';
      const event = makeEvent({
        type: 'error',
        message: messageText,
        ts: Date.now(),
        sessionKey: activeSessionKey.startsWith('pending:') ? chatSessionKey ?? undefined : activeSessionKey,
      });
      soundManager.play('error');
      set((state) => ({
        chatLoading: false,
        chatStreamingText: '',
        chatError: messageText,
        chatStreamController: null,
        recentEvents: [event, ...state.recentEvents].slice(0, 5),
      }));
    }
  },
  loadChatHistory: async (sessionKey) => {
    set({ chatLoading: true, chatStreamingText: '', chatError: null, chatSessionKey: sessionKey });

    try {
      const response = await fetch(`/clawcraft/chat/${encodeURIComponent(sessionKey)}/history`);
      if (!response.ok) {
        throw new Error(`Failed to load chat history (${response.status})`);
      }

      const payload = await response.json();
      const messages = Array.isArray(payload.messages)
        ? payload.messages.map((message) => ({
            id: message.id ?? `history-${message.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
            sessionKey,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp,
            toolName: message.toolName,
          }))
        : [];

      set((prevState) => {
        // If API returned empty but we already have messages (e.g. optimistic send), keep them
        const finalMessages = messages.length > 0
          ? dedupeMessages(messages)
          : prevState.chatMessages.length > 0
            ? prevState.chatMessages
            : [];
        return { chatMessages: finalMessages, chatLoading: false, chatError: null };
      });
      // Persist loaded history
      const currentMessages = get().chatMessages;
      persistChat(sessionKey, get().chatTargetAgent, currentMessages);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to load chat history';
      const event = makeEvent({
        type: 'error',
        message: messageText,
        ts: Date.now(),
        sessionKey,
      });
      soundManager.play('error');
      set((state) => ({
        chatLoading: false,
        chatError: messageText,
        recentEvents: [event, ...state.recentEvents].slice(0, 5),
      }));
    }
  },
  abortChatStream: () => {
    get().chatStreamController?.abort();
  },
  startNewChatSession: () => {
    get().chatStreamController?.abort();
    clearPersistedChat();
    set({
      chatLoading: false,
      chatStreamingText: '',
      chatError: null,
      chatStreamController: null,
      chatSessionKey: null,
      chatMessages: [],
      chatDrawerOpen: true,
    });
  },
  setChatSessionKey: (sessionKey) =>
    set({
      chatSessionKey: sessionKey,
      chatMessages: [],
      chatStreamingText: '',
      chatError: null,
      chatDrawerOpen: true,
    }),
  requestChatFocus: () => set({ chatFocusNonce: Date.now() }),
  toggleMuted: () =>
    set((state) => {
      const nextMuted = !state.muted;
      soundManager.setMuted(nextMuted);
      return { muted: nextMuted };
    }),
  setChatDrawerOpen: (chatDrawerOpen) => set({ chatDrawerOpen }),
  setActivityPanelOpen: (activityPanelOpen) => set({ activityPanelOpen }),
  setChatTargetAgent: (agentId) =>
    set((state) => {
      state.chatStreamController?.abort();
      const nextSessionKey = resolveChatSessionForAgent(agentId, state);
      persistChat(nextSessionKey, agentId, []);
      return {
        chatTargetAgent: agentId,
        chatSessionKey: nextSessionKey,
        chatMessages: [],
        chatStreamingText: '',
        chatError: null,
        chatStreamController: null,
        chatDrawerOpen: true,
      };
    }),
}));

// Expose store globally for debugging / browser automation
if (typeof window !== 'undefined') {
  (window as any).__worldStore = useWorldStore;
}

function dedupeMessages(messages: ChatMessage[]) {
  const seenIds = new Set<string>();
  const seenFallback = new Set<string>();

  return messages.filter((message) => {
    if (message.id) {
      if (seenIds.has(message.id)) {
        return false;
      }
      seenIds.add(message.id);
    }

    const fallbackKey = `${message.sessionKey}:${message.role}:${message.toolName ?? ''}:${message.content}:${message.timestamp}`;
    if (seenFallback.has(fallbackKey)) {
      return false;
    }
    seenFallback.add(fallbackKey);
    return true;
  });
}

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
  toggleMuted: () => void;
  chatDrawerOpen: boolean;
  activityPanelOpen: boolean;
  chatTargetAgent: string;
  setChatDrawerOpen: (open: boolean) => void;
  setActivityPanelOpen: (open: boolean) => void;
  setChatTargetAgent: (agentId: string) => void;
}

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
  chatSessionKey: null,
  chatMessages: [] as ChatMessage[],
  chatLoading: false,
  muted: false,
  chatDrawerOpen: false,
  activityPanelOpen: false,
  chatTargetAgent: 'main',
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

export const useWorldStore = create<WorldStore>((set, get) => ({
  ...initialState,
  resetWorld: () =>
    set((state) => ({
      ...initialState,
      developerMode: state.developerMode,
      muted: state.muted,
    })),
  setFullState: (state) =>
    set((current) => {
      const selectedExists =
        current.selectedEntityType === 'gateway' ||
        (current.selectedEntityType === 'agent' && Boolean(state.agents[current.selectedEntityId ?? ''])) ||
        (current.selectedEntityType === 'session' && Boolean(state.sessions[current.selectedEntityId ?? '']));

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
        chatTargetAgent:
          current.chatTargetAgent && (state.agents?.[current.chatTargetAgent] || current.chatTargetAgent === 'main')
            ? current.chatTargetAgent
            : Object.keys(state.agents ?? {})[0] ?? 'main',
        chatSessionKey:
          selectedExists && current.selectedEntityId && current.selectedEntityType
            ? resolveChatSession(current.selectedEntityId, current.selectedEntityType, {
                agents: state.agents ?? {},
                sessions: state.sessions ?? {},
              })
            : resolveChatSessionForAgent(
                current.chatTargetAgent && (state.agents?.[current.chatTargetAgent] || current.chatTargetAgent === 'main')
                  ? current.chatTargetAgent
                  : Object.keys(state.agents ?? {})[0] ?? 'main',
                {
                  agents: state.agents ?? {},
                  sessions: state.sessions ?? {},
                },
              ),
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

        if (state.chatSessionKey === delta.sessionKey) {
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

      const nextChatSessionKey =
        state.selectedEntityType === 'session' && state.selectedEntityId
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

    const optimisticMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      sessionKey: chatSessionKey ?? `pending:${chatTargetAgent}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    set((state) => ({
      chatLoading: true,
      chatMessages: dedupeMessages([...state.chatMessages, optimisticMessage]),
    }));

    try {
      const response = await fetch('/clawcraft/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionKey: chatSessionKey,
          agentId: chatTargetAgent,
          message: trimmed,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message (${response.status})`);
      }

      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(payload.error || 'Failed to send chat message');
      }

      if (typeof payload.sessionKey === 'string' && payload.sessionKey) {
        set((state) => ({
          chatSessionKey: payload.sessionKey,
          chatTargetAgent,
          chatMessages: state.chatSessionKey
            ? state.chatMessages
            : state.chatMessages.map((entry) =>
                entry.sessionKey === `pending:${chatTargetAgent}`
                  ? { ...entry, sessionKey: payload.sessionKey }
                  : entry,
              ),
        }));
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to send chat message';
      const event = makeEvent({
        type: 'error',
        message: messageText,
        ts: Date.now(),
        sessionKey: chatSessionKey,
      });
      soundManager.play('error');
      set((state) => ({
        recentEvents: [event, ...state.recentEvents].slice(0, 5),
      }));
    } finally {
      set({ chatLoading: false });
    }
  },
  loadChatHistory: async (sessionKey) => {
    set({ chatLoading: true, chatSessionKey: sessionKey });

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

      set({ chatMessages: dedupeMessages(messages), chatLoading: false });
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
        recentEvents: [event, ...state.recentEvents].slice(0, 5),
      }));
    }
  },
  toggleMuted: () =>
    set((state) => {
      const nextMuted = !state.muted;
      soundManager.setMuted(nextMuted);
      return { muted: nextMuted };
    }),
  setChatDrawerOpen: (chatDrawerOpen) => set({ chatDrawerOpen }),
  setActivityPanelOpen: (activityPanelOpen) => set({ activityPanelOpen }),
  setChatTargetAgent: (agentId) =>
    set((state) => ({
      chatTargetAgent: agentId,
      chatSessionKey: resolveChatSessionForAgent(agentId, state),
      chatMessages: [],
      chatDrawerOpen: true,
    })),
}));

// Expose store globally for debugging / browser automation
if (typeof window !== 'undefined') {
  (window as any).__worldStore = useWorldStore;
}

function dedupeMessages(messages: ChatMessage[]) {
  const seen = new Set<string>();

  return messages.filter((message) => {
    const key = `${message.id}:${message.role}:${message.content}:${message.timestamp}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

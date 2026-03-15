export type GatewayStatus = 'running' | 'stopping' | 'unknown' | 'restarting' | 'stopped';
export type EntityType = 'agent' | 'session' | 'gateway' | 'building';
export type SessionStatus = 'idle' | 'thinking' | 'tooling' | 'responding' | 'blocked' | 'ended';
export type UnitCardTab = 'overview' | 'chat' | 'timeline';
export type IncidentSeverity = 'info' | 'warning' | 'error' | 'critical';
export type IncidentStatus = 'open' | 'acked' | 'resolved' | 'muted';
export type BuildingType = 'channel' | 'skill' | 'plugin' | 'memory' | 'model' | 'files' | 'tools' | 'cron';

export interface AgentState {
  agentId: string;
  name: string;
  model: string;
  status: 'online' | 'offline' | 'busy' | 'degraded';
  soulSummary: string;
  toolNames: string[];
  skillIds: string[];
  sessionKeys: string[];
}

export interface SessionState {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  status: SessionStatus;
  currentTool?: string | null;
  currentToolCategory?: string | null;
  currentToolArgsPreview?: string | null;
  lastAssistantPreview?: string | null;
  lastThinkingPreview?: string | null;
  runCount: number;
  toolCallCount: number;
  errorCount: number;
  lastActivityTs: number;
}

export interface Incident {
  id: string;
  severity: IncidentSeverity;
  source: { type: string; id: string };
  title: string;
  detail: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  status: IncidentStatus;
  blastRadius: string[];
  suggestedActions: { label: string; actionType: string; params: any; safety: string }[];
}

export interface ChannelStatus {
  name: string;
  type: string;
  status: 'connected' | 'disconnected' | 'error' | 'unknown';
  lastSeen: number;
  messageCount: number;
}

export interface OvernightSummary {
  since: number;
  cronRuns: { total: number; success: number; failed: number };
  channelEvents: { channel: string; event: string; at: number }[];
  errors: { source: string; type: string; count: number; lastAt: number }[];
  tokenUsage: { total: number; byAgent: Record<string, number> };
  compactions: number;
}

export interface OnboardingProgress {
  hasChannel: boolean;
  hasRoute: boolean;
  firstMessageSent: boolean;
  agentCount: number;
}

export interface KingdomBuildingItem {
  name: string;
  detail?: string;
  status?: string;
  tools?: string[];
}

export interface KingdomBuilding {
  id: string;
  type: BuildingType;
  name: string;
  icon: string;
  count: number;
  items: KingdomBuildingItem[];
  agentId?: string;
}

export interface WorldState {
  serverInstanceId: string | null;
  version?: string;
  uptime?: number;
  agents: Record<string, AgentState>;
  sessions: Record<string, SessionState>;
  gatewayStatus: GatewayStatus;
  channels?: Record<string, ChannelStatus>;
  buildings?: KingdomBuilding[];
  incidents?: Incident[];
  overnightSummary?: OvernightSummary;
  onboardingProgress?: OnboardingProgress;
}

export interface ChatMessage {
  id: string;
  sessionKey: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  metadata?: Record<string, any>;
}

export interface SSEEvent {
  id: string;
  type: 'info' | 'thinking' | 'tool' | 'error' | 'complete' | 'connection';
  message: string;
  ts: number;
  agentId?: string;
  sessionKey?: string;
  toolName?: string;
}

export type ActivityEventType = 'message' | 'tool_call' | 'file_change' | 'subagent' | 'cron' | 'error';

export interface ActivityEvent {
  id: string;
  timestamp: number;
  agentId: string;
  sessionKey?: string;
  type: ActivityEventType;
  summary: string;
  detail?: string;
  metadata?: Record<string, any>;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  size: number;
  mtime: number;
  agentId: string;
  type: 'code' | 'doc' | 'config' | 'other';
}

export interface ActivityStats {
  llmCallsToday: number;
  tokensToday: number;
  toolCallsToday: number;
  toolUsageTop: Array<{ name: string; count: number }>;
  fileChangesToday: number;
  activeSessions: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  serverInstanceId: string;
  uptime: number;
  mock?: boolean;
}

export type ServerDelta =
  | {
      type: 'session-update';
      sessionKey: string;
      changes: Partial<SessionState>;
    }
  | {
      type: 'session-created';
      session: SessionState;
    }
  | {
      type: 'event';
      event: {
        type: 'error' | 'thinking' | 'tool' | 'complete' | 'info';
        sessionKey?: string;
        agentId?: string;
        message: string;
        ts: number;
      };
    }
  | {
      type: 'chat-message';
      sessionKey: string;
      message: Omit<ChatMessage, 'id' | 'sessionKey'> & Partial<Pick<ChatMessage, 'id'>>;
    }
  | {
      type: 'incident-created';
      incident: Incident;
    }
  | {
      type: 'incident-updated';
      id: string;
      changes: Partial<Incident>;
    };

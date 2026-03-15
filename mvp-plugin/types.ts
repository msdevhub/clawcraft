/**
 * ClawCraft Plugin — Types
 * Shared interfaces for state model, SSE, and API responses
 */

export type SessionStatus = 'idle' | 'thinking' | 'tooling' | 'responding' | 'blocked' | 'ended';
export type ToolCategory = 'gather' | 'observe' | 'build' | 'forge' | 'memory' | 'message' | 'spawn' | 'other';
export type IncidentSeverity = 'info' | 'warning' | 'error' | 'critical';
export type IncidentStatus = 'open' | 'acked' | 'resolved' | 'muted';
export type BuildingType = 'channel' | 'skill' | 'plugin' | 'memory' | 'model' | 'files' | 'tools' | 'cron';

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
  suggestedActions: { label: string; actionType: string; params: any; safety: '🟢' | '🟡' | '🟠' }[];
}

export interface ChannelStatus {
  name: string;
  type: string;
  status: 'connected' | 'disconnected' | 'error' | 'unknown';
  lastSeen: number;
  messageCount: number;
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
  agentId?: string;  // which agent this building belongs to (undefined = global)
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

export interface AgentState {
  agentId: string;
  name: string;
  model: string;
  status: 'online' | 'offline';
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

export interface WorldState {
  serverInstanceId: string;
  version: string;
  uptime: number;
  agents: Record<string, AgentState>;
  sessions: Record<string, SessionState>;
  gatewayStatus: 'running' | 'stopping' | 'unknown';
  channels: Record<string, ChannelStatus>;
  buildings: KingdomBuilding[];
  incidents: Incident[];
  overnightSummary?: OvernightSummary;
  onboardingProgress?: OnboardingProgress;
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

export interface ServerDelta {
  type: 'session-update' | 'session-created' | 'event' | 'chat-message' | 'incident-created' | 'incident-updated';
  [key: string]: any;
}

/**
 * ClawCraft Plugin — Main Entry (v3 — real chat, file editor, memory)
 *
 * New in v3:
 *   - POST /clawcraft/chat/send   → proxies to /v1/chat/completions (streaming)
 *   - GET  /clawcraft/chat/:key/history → reads session transcript from disk
 *   - GET  /clawcraft/files       → read agent workspace files (SOUL.md etc.)
 *   - POST /clawcraft/files       → write agent workspace files
 *   - POST /clawcraft/memory      → memory_recall / memory_store / memory_forget
 *   - POST /clawcraft/action type=session.compact / session.reset
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  ActivityEvent,
  AgentState,
  ChannelStatus,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  KingdomBuilding,
  KingdomBuildingItem,
  OnboardingProgress,
  OvernightSummary,
  ServerDelta,
  SessionState,
  SessionStatus,
  ToolCategory,
  WorldState,
  WorkspaceFileEntry,
} from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const VERSION = "0.6.0";
const HEARTBEAT_INTERVAL = 15_000;
const CHANNEL_CHECK_INTERVAL = 60_000;
const AUTO_RESOLVE_MS = 300_000;
const EVICT_ENDED_AFTER_MS = 60_000;
const TRUNCATE_PREVIEW = 200;
const MAX_ACTIVITY_EVENTS = 500;

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  web_search: 'gather', web_fetch: 'gather', browser: 'gather',
  read: 'observe', image: 'observe', pdf: 'observe',
  write: 'build', edit: 'build',
  exec: 'forge', process: 'forge',
  memory_store: 'memory', memory_recall: 'memory', memory_forget: 'memory', memory_update: 'memory',
  memory_search: 'memory', memory_get: 'memory',
  message: 'message', tts: 'message', sessions_send: 'message',
  sessions_spawn: 'spawn',
};

const BUILTIN_TOOL_NAMES = Object.keys(TOOL_CATEGORIES);
const TOOL_NAME_KEYS = new Set(['name', 'id', 'tool', 'toolName']);
const TOOL_CONTAINER_KEYS = new Set(['tools', 'toolNames', 'availableTools', 'enabledTools', 'builtinTools']);
const SKILL_TOOL_STOPWORDS = new Set([
  'default_prompt',
  'display_name',
  'short_description',
  'current_date',
  'snake_case',
  'openai_yaml',
  'project_focus',
  'project_save',
]);
const PROVIDER_DEFAULTS: Record<string, { url: string; headers?: Record<string, string>; auth?: 'bearer' | 'api-key' | 'google-query' }> = {
  openai: { url: 'https://api.openai.com/v1/models', auth: 'bearer' },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    auth: 'api-key',
    headers: { 'anthropic-version': '2023-06-01' },
  },
  google: { url: 'https://generativelanguage.googleapis.com/v1beta/models', auth: 'google-query' },
};
const CONFIG_UPDATE_WHITELIST = new Set([
  'agents.defaults.model',
  'agents.defaults.heartbeat',
  'agents.defaults.compaction',
  'agents.defaults.contextPruning',
  'agents.list',
  'browser',
  'bindings',
  'canvasHost',
  'env',
  'commands',
  'discovery',
  'gateway',
  'hooks',
  'logging',
  'messages',
  'messages.tts',
  'session',
  'skills',
  'talk',
  'tools.elevated',
  'tools.exec',
  'tools.loopDetection',
  'tools.web',
]);
const MASKED_SECRET_PREFIX = '***';

function categorizeTool(name: string): ToolCategory {
  return TOOL_CATEGORIES[name] || 'other';
}

function truncate(s: string | undefined | null, max = TRUNCATE_PREVIEW): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function previewValue(value: unknown, max = TRUNCATE_PREVIEW): string {
  if (typeof value === 'string') return truncate(value, max) || '';
  if (value === null || value === undefined) return '';
  try {
    return truncate(JSON.stringify(value), max) || '';
  } catch {
    return truncate(String(value), max) || '';
  }
}

function extractFilePath(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;

  for (const key of ['path', 'file', 'target', 'target_file', 'output', 'outputPath', 'dest']) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveHomePath(value: string | undefined | null, homeDir: string): string | null {
  if (!value) return null;
  return value.startsWith('~/') ? value.replace(/^~(?=\/)/, homeDir) : value;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function getProviderBaseUrl(providerConfig: any): string | null {
  if (!providerConfig) return null;
  if (typeof providerConfig.baseUrl === 'string' && providerConfig.baseUrl) return providerConfig.baseUrl;
  if (typeof providerConfig.baseURL === 'string' && providerConfig.baseURL) return providerConfig.baseURL;
  return null;
}

function getProviderDefaultModel(providerConfig: any): string | null {
  if (!providerConfig) return null;
  if (typeof providerConfig.defaultModel === 'string' && providerConfig.defaultModel) return providerConfig.defaultModel;
  if (typeof providerConfig.model === 'string' && providerConfig.model) return providerConfig.model;
  if (typeof providerConfig.models?.default === 'string' && providerConfig.models.default) return providerConfig.models.default;
  if (Array.isArray(providerConfig.models) && typeof providerConfig.models[0] === 'string') return providerConfig.models[0];
  return null;
}

function getAgentDefaultModel(config: any): string | null {
  const modelConfig = config?.agents?.defaults?.model;
  if (typeof modelConfig === 'string' && modelConfig) return modelConfig;
  if (isRecord(modelConfig) && typeof modelConfig.primary === 'string' && modelConfig.primary) return modelConfig.primary;
  return null;
}

function getAgentDisplayName(agentConfig: any): string | null {
  if (typeof agentConfig?.identity?.name === 'string' && agentConfig.identity.name) return agentConfig.identity.name;
  if (typeof agentConfig?.name === 'string' && agentConfig.name) return agentConfig.name;
  return null;
}

function maskSecret(value: string | undefined | null, visible = 6): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('***')) return value;
  return `***${value.slice(-visible)}`;
}

function isMaskedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MASKED_SECRET_PREFIX);
}

function mergeMaskedValues(current: Record<string, any>, updates: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = { ...current };

  for (const [key, value] of Object.entries(updates)) {
    if (isMaskedSecret(value) && typeof current[key] === 'string' && !String(current[key]).startsWith(MASKED_SECRET_PREFIX)) {
      continue;
    }
    next[key] = value;
  }

  return next;
}

function preserveMaskedSecrets(current: any, next: any): any {
  if (isMaskedSecret(next) && typeof current === 'string' && !String(current).startsWith(MASKED_SECRET_PREFIX)) {
    return current;
  }

  if (Array.isArray(next)) {
    const currentItems = Array.isArray(current) ? current : [];
    return next.map((item, index) => preserveMaskedSecrets(currentItems[index], item));
  }

  if (isRecord(next)) {
    const currentRecord = isRecord(current) ? current : {};
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(next)) {
      result[key] = preserveMaskedSecrets(currentRecord[key], value);
    }

    return result;
  }

  return next;
}

function normalizeToolName(value: string): string | null {
  const normalized = value.trim().replace(/-/g, '_').toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(normalized)) return null;
  return normalized;
}

function addToolName(value: string, target: Set<string>) {
  const normalized = normalizeToolName(value);
  if (!normalized || SKILL_TOOL_STOPWORDS.has(normalized)) return;
  if (normalized.includes('__')) return;
  target.add(normalized);
}

function extractToolNamesFromContainer(value: unknown, target: Set<string>) {
  if (typeof value === 'string') {
    addToolName(value, target);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) extractToolNamesFromContainer(entry, target);
    return;
  }

  if (!isRecord(value)) return;

  for (const key of TOOL_NAME_KEYS) {
    if (typeof value[key] === 'string') addToolName(value[key], target);
  }

  for (const [key, nested] of Object.entries(value)) {
    if (TOOL_CONTAINER_KEYS.has(key)) {
      extractToolNamesFromContainer(nested, target);
    }
  }
}

function collectToolNamesFromStatus(input: unknown, target: Set<string>, depth = 0) {
  if (!input || depth > 5) return;

  if (Array.isArray(input)) {
    for (const value of input) collectToolNamesFromStatus(value, target, depth + 1);
    return;
  }

  if (!isRecord(input)) return;

  for (const [key, value] of Object.entries(input)) {
    if (TOOL_CONTAINER_KEYS.has(key)) {
      extractToolNamesFromContainer(value, target);
    } else if (isRecord(value) || Array.isArray(value)) {
      collectToolNamesFromStatus(value, target, depth + 1);
    }
  }
}

function extractToolNamesFromSkillContent(content: string): string[] {
  const tools = new Set<string>();

  for (const match of content.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)*)`/g)) {
    addToolName(match[1], tools);
  }

  for (const match of content.matchAll(/\b([a-z][a-z0-9]*_[a-z0-9_]+)\b/g)) {
    addToolName(match[1], tools);
  }

  return Array.from(tools).sort();
}

function summarizeSources(values: Iterable<string>): string | undefined {
  const unique = Array.from(new Set(values)).sort();
  if (unique.length === 0) return undefined;
  if (unique.length === 1 && unique[0] === 'workspace') return 'main workspace';
  return unique.join(' · ');
}

function getConfiguredToolNames(config: any): string[] {
  const tools = new Set<string>();
  const agentsList = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  collectToolNamesFromStatus(config?.agents?.defaults, tools);
  for (const agent of agentsList) collectToolNamesFromStatus(agent, tools);
  return Array.from(tools).sort();
}

async function scanSkills(config: any): Promise<{ items: KingdomBuildingItem[]; toolNames: string[]; perAgent: Map<string, KingdomBuildingItem[]> }> {
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const { readdir, readFile } = await import('node:fs/promises');

  const homeDir = homedir();
  const roots = new Map<string, string>();
  roots.set('workspace', join(homeDir, '.openclaw', 'workspace'));

  const agentList = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  for (const agent of agentList) {
    if (!agent?.id || typeof agent.workspace !== 'string') continue;
    const resolved = resolveHomePath(agent.workspace, homeDir);
    if (resolved) roots.set(`agent:${agent.id}`, resolved);
  }

  const skillSources = new Map<string, Set<string>>();
  const toolNames = new Set<string>();

  for (const [source, root] of roots) {
    const skillsDir = join(root, 'skills');
    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const existing = skillSources.get(entry.name) ?? new Set<string>();
        existing.add(source);
        skillSources.set(entry.name, existing);

        try {
          const content = await readFile(join(skillsDir, entry.name, 'SKILL.md'), 'utf-8');
          for (const tool of extractToolNamesFromSkillContent(content)) {
            addToolName(tool, toolNames);
          }
        } catch {
          // Ignore missing SKILL.md files; the directory still counts as an installed skill.
        }
      }
    } catch {
      // Ignore missing skill roots.
    }
  }

  const items = Array.from(skillSources.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, sources]) => ({ name, detail: summarizeSources(sources) }));

  // Build per-agent skill items
  const perAgent = new Map<string, KingdomBuildingItem[]>();
  for (const [name, sources] of skillSources) {
    for (const source of sources) {
      const agentId = source === 'workspace' ? 'main' : source.replace('agent:', '');
      const existing = perAgent.get(agentId) ?? [];
      existing.push({ name });
      perAgent.set(agentId, existing);
    }
  }

  return { items, toolNames: Array.from(toolNames).sort(), perAgent };
}

async function getGatewayToolNames(): Promise<string[]> {
  try {
    const response = await gatewayFetch('/v1/status', { timeoutMs: 3_000 });
    if (response.status < 200 || response.status >= 300) return [];
    const parsed = JSON.parse(response.body);
    const tools = new Set<string>();
    collectToolNamesFromStatus(parsed, tools);
    return Array.from(tools).sort();
  } catch {
    return [];
  }
}

async function buildToolsBuilding(config: any, skillToolNames: string[]): Promise<KingdomBuilding> {
  const mergedTools = new Set<string>(BUILTIN_TOOL_NAMES);
  for (const tool of await getGatewayToolNames()) addToolName(tool, mergedTools);
  for (const tool of getConfiguredToolNames(config)) addToolName(tool, mergedTools);
  for (const tool of skillToolNames) addToolName(tool, mergedTools);

  const toolsByCategory = new Map<ToolCategory, string[]>();
  for (const tool of Array.from(mergedTools).sort()) {
    const category = categorizeTool(tool);
    const current = toolsByCategory.get(category) ?? [];
    current.push(tool);
    toolsByCategory.set(category, current);
  }

  const items: KingdomBuildingItem[] = Array.from(toolsByCategory.entries()).map(([category, tools]) => ({
    name: category,
    detail: `${tools.length} tools`,
    status: `${tools.length} available`,
    tools,
  }));

  items.sort((left, right) => left.name.localeCompare(right.name));

  return {
    id: 'tools',
    type: 'tools',
    name: '工具库 Tools',
    icon: '⚒️',
    count: Array.from(mergedTools).length,
    items,
  };
}

function getCronJobId(job: any): string {
  if (typeof job?.id === 'string' && job.id) return job.id;
  if (typeof job?.jobId === 'string' && job.jobId) return job.jobId;
  return '';
}

function getCronJobName(job: any): string {
  return typeof job?.name === 'string' && job.name ? job.name : getCronJobId(job) || 'unnamed-cron-job';
}

function getCronJobStatus(job: any): string {
  if (job?.enabled === false) return 'disabled';

  const state = isRecord(job?.state) ? job.state : {};
  const lastStatus = typeof state.lastRunStatus === 'string'
    ? state.lastRunStatus
    : typeof state.lastStatus === 'string'
      ? state.lastStatus
      : typeof job?.lastRunStatus === 'string'
        ? job.lastRunStatus
        : typeof job?.lastStatus === 'string'
          ? job.lastStatus
          : '';

  return lastStatus || 'idle';
}

function formatCronSchedule(schedule: any): string {
  if (!isRecord(schedule)) return '未配置 schedule';

  if (typeof schedule.expr === 'string' && schedule.expr) {
    return schedule.tz ? `${schedule.expr} (${schedule.tz})` : schedule.expr;
  }

  if (typeof schedule.at === 'string' && schedule.at) {
    return schedule.tz ? `${schedule.at} (${schedule.tz})` : schedule.at;
  }

  if (typeof schedule.atMs === 'number' && Number.isFinite(schedule.atMs)) {
    const iso = new Date(schedule.atMs).toISOString();
    return schedule.tz ? `${iso} (${schedule.tz})` : iso;
  }

  if (typeof schedule.everyMs === 'number' && Number.isFinite(schedule.everyMs)) {
    return `every ${schedule.everyMs}ms`;
  }

  return '未配置 schedule';
}

// 读取 cron jobs
async function loadCronJobs(): Promise<any[]> {
  const { homedir } = await import('node:os');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  try {
    const raw = await readFile(join(homedir(), '.openclaw', 'cron', 'jobs.json'), 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data?.jobs) ? data.jobs : [];
  } catch {
    return [];
  }
}

// 读取 cron 运行历史
async function loadCronRuns(jobId: string, limit = 20): Promise<any[]> {
  const { homedir } = await import('node:os');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  try {
    const raw = await readFile(join(homedir(), '.openclaw', 'cron', 'runs', `${jobId}.jsonl`), 'utf-8');
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function shellEscapeArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildShellCommand(args: string[]): string {
  return args.map((arg) => shellEscapeArg(String(arg))).join(' ');
}

async function runCronCli(args: string[], timeoutMs = 30_000): Promise<string> {
  const { execSync } = await import('node:child_process');
  const output = execSync(buildShellCommand(['openclaw', 'cron', ...args]), {
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  return output.trim();
}

// Direct file manipulation for fast toggle/remove (avoids slow CLI cold-start)
async function writeCronJobs(jobs: any[]): Promise<void> {
  const { homedir } = await import('node:os');
  const { writeFile, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const jobsPath = join(homedir(), '.openclaw', 'cron', 'jobs.json');
  // Preserve any extra top-level fields
  let wrapper: any = { jobs: [] };
  try {
    const raw = await readFile(jobsPath, 'utf-8');
    wrapper = JSON.parse(raw);
  } catch {}
  wrapper.jobs = jobs;
  await writeFile(jobsPath, JSON.stringify(wrapper, null, 2) + '\n', 'utf-8');
}

// ============ Layout Persistence ============

function isLayoutPosition(value: unknown): value is { x: number; y: number } {
  return typeof value === 'object'
    && value !== null
    && typeof (value as any).x === 'number'
    && Number.isFinite((value as any).x)
    && typeof (value as any).y === 'number'
    && Number.isFinite((value as any).y);
}

interface LayoutData {
  positions: Record<string, { x: number; y: number }>;
  walls: { col: number; row: number }[];
}

async function readLayoutFile(): Promise<LayoutData> {
  const { homedir } = await import('node:os');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const layoutPath = join(homedir(), '.openclaw', 'clawcraft', 'layout.json');

  try {
    const raw = await readFile(layoutPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const nextPositions: Record<string, { x: number; y: number }> = {};
    const positions = parsed?.positions;

    if (isRecord(positions)) {
      for (const [key, value] of Object.entries(positions)) {
        if (isLayoutPosition(value)) {
          nextPositions[key] = { x: value.x, y: value.y };
        }
      }
    }

    const walls: LayoutData['walls'] = [];
    if (Array.isArray(parsed?.walls)) {
      for (const w of parsed.walls) {
        if (typeof w?.col === 'number' && typeof w?.row === 'number') {
          walls.push({ col: w.col, row: w.row });
        }
      }
    }

    return { positions: nextPositions, walls };
  } catch {
    return { positions: {}, walls: [] };
  }
}

async function writeLayoutFile(data: LayoutData): Promise<void> {
  const { homedir } = await import('node:os');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const layoutDir = join(homedir(), '.openclaw', 'clawcraft');
  const layoutPath = join(layoutDir, 'layout.json');

  await mkdir(layoutDir, { recursive: true });
  await writeFile(layoutPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

async function actionLayoutSave(params: any): Promise<ActionResult> {
  const current = await readLayoutFile();

  // Merge positions if provided
  if (isRecord(params?.positions)) {
    for (const [key, value] of Object.entries(params.positions)) {
      if (!isLayoutPosition(value)) {
        return { ok: false, error: `Invalid layout position for ${key}` };
      }
      current.positions[key] = { x: (value as any).x, y: (value as any).y };
    }
  }

  // Replace walls if provided
  if (Array.isArray(params?.walls)) {
    current.walls = [];
    for (const w of params.walls) {
      if (typeof w?.col === 'number' && typeof w?.row === 'number') {
        current.walls.push({ col: w.col, row: w.row });
      }
    }
  }

  await writeLayoutFile(current);
  return { ok: true, data: current };
}

async function actionLayoutLoad(): Promise<ActionResult> {
  const layout = await readLayoutFile();
  return { ok: true, data: { positions: layout.positions, walls: layout.walls } };
}

// ============================================================================
// SSE Client Manager
// ============================================================================

const sseClients = new Set<ServerResponse>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const client of sseClients) {
      try { client.write(':heartbeat\n\n'); } catch { sseClients.delete(client); }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function broadcast(delta: ServerDelta) {
  const payload = `event: state-update\ndata: ${JSON.stringify(delta)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// ============================================================================
// State Manager
// ============================================================================

const agents = new Map<string, AgentState>();
const sessions = new Map<string, SessionState>();
const incidents = new Map<string, Incident>();
const channelStatuses = new Map<string, ChannelStatus>();
const serverInstanceId = randomUUID();
const startTime = Date.now();
let log: any = console;

// Overnight Summary Counters
let counters = {
  cronRuns: { total: 0, success: 0, failed: 0 },
  compactions: 0,
  toolErrors: 0,
  errors: [] as { source: string; type: string; count: number; lastAt: number }[],
  tokenUsage: { total: 0, byAgent: {} as Record<string, number> },
  channelEvents: [] as { channel: string; event: string; at: number }[]
};
let lastUserAccess = Date.now();
let cachedConfig: any = null;
let cachedBuildings: KingdomBuilding[] = [];
let buildingsLastRefresh = 0;
const BUILDINGS_REFRESH_MS = 30_000; // Refresh buildings every 30s
let activityEvents: ActivityEvent[] = [];
const RECENT_WORKSPACE_WINDOW_MS = 24 * 60 * 60 * 1000;
const WORKSPACE_SCAN_MAX_DEPTH = 5;
const WORKSPACE_SCAN_MAX_RESULTS = 200;
const WORKSPACE_SCAN_DIR_SKIP = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'coverage']);
const WORKSPACE_SCAN_HIDDEN_DIR_ALLOWLIST = new Set(['.learnings']);

function recordActivity(event: Omit<ActivityEvent, 'id'>) {
  activityEvents = [
    {
      id: `activity-${event.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      ...event,
    },
    ...activityEvents,
  ].slice(0, MAX_ACTIVITY_EVENTS);
}

function getActivityStats(agentId?: string) {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const since = startOfToday.getTime();
  const filtered = activityEvents.filter((event) => event.timestamp >= since && (!agentId || event.agentId === agentId));
  const toolUsage = new Map<string, number>();
  let tokensToday = 0;

  for (const event of filtered) {
    if (event.type === 'tool_call') {
      const toolName = typeof event.metadata?.toolName === 'string' ? event.metadata.toolName : 'unknown';
      toolUsage.set(toolName, (toolUsage.get(toolName) || 0) + 1);
    }
    if (typeof event.metadata?.tokens === 'number') {
      tokensToday += event.metadata.tokens;
    }
  }

  return {
    llmCallsToday: filtered.filter((event) => event.type === 'message' && event.metadata?.direction === 'assistant').length,
    tokensToday,
    toolCallsToday: filtered.filter((event) => event.type === 'tool_call').length,
    toolUsageTop: Array.from(toolUsage.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
    fileChangesToday: filtered.filter((event) => event.type === 'file_change').length,
    activeSessions: Array.from(sessions.values()).filter((session) => session.status !== 'ended' && (!agentId || session.agentId === agentId)).length,
  };
}

function classifyWorkspaceFile(name: string): WorkspaceFileEntry['type'] {
  if (/\.(ts|tsx|js|jsx|py)$/i.test(name)) return 'code';
  if (/\.(md|txt)$/i.test(name)) return 'doc';
  if (/\.(json|ya?ml)$/i.test(name)) return 'config';
  return 'other';
}

function resolveActivityAgentId(context: any, sessionKey?: string): string {
  if (typeof context?.agentId === 'string' && context.agentId) return context.agentId;
  if (sessionKey && sessions.has(sessionKey)) return sessions.get(sessionKey)!.agentId;
  return 'main';
}

function extractContentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => extractContentText(entry)).filter(Boolean).join('\n');
  if (!isRecord(value)) return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) return extractContentText(value.content);
  return '';
}

function extractPromptPreview(event: any): string | undefined {
  const direct =
    extractContentText(event?.message)
    || extractContentText(event?.input)
    || extractContentText(event?.prompt)
    || extractContentText(event?.content)
    || extractContentText(event?.text);

  if (direct) return truncate(direct, TRUNCATE_PREVIEW) || undefined;

  if (Array.isArray(event?.messages)) {
    for (let i = event.messages.length - 1; i >= 0; i -= 1) {
      const message = event.messages[i];
      if (message?.role === 'user') {
        const text = extractContentText(message?.content ?? message);
        if (text) return truncate(text, TRUNCATE_PREVIEW) || undefined;
      }
    }

    const preview = previewValue(event.messages, TRUNCATE_PREVIEW);
    return preview || undefined;
  }

  const preview = previewValue(event, TRUNCATE_PREVIEW);
  return preview || undefined;
}

function extractAssistantPreview(event: any): string | undefined {
  const texts = Array.isArray(event?.assistantTexts) ? event.assistantTexts.filter((value: unknown) => typeof value === 'string') : [];
  const text = texts.join('\n') || extractContentText(event?.content) || extractContentText(event?.text) || extractContentText(event?.message);
  if (text) return truncate(text, 400) || undefined;
  return undefined;
}

function extractErrorMessage(errorLike: unknown): string | undefined {
  if (!errorLike) return undefined;
  if (typeof errorLike === 'string') return errorLike;
  if (isRecord(errorLike)) {
    if (typeof errorLike.message === 'string' && errorLike.message) return errorLike.message;
    if (typeof errorLike.error === 'string' && errorLike.error) return errorLike.error;
  }
  const preview = previewValue(errorLike, TRUNCATE_PREVIEW);
  return preview || undefined;
}

function normalizeToolNameFromEvent(event: any): string {
  return event?.tool || event?.name || event?.toolName || 'unknown';
}

function extractToolArgsPreview(event: any): string | undefined {
  const preview = previewValue(event?.args ?? event?.input ?? event?.params, 240);
  return preview || undefined;
}

function extractToolResultPreview(event: any): string | undefined {
  const preview = previewValue(event?.result ?? event?.output ?? event?.response, 240);
  return preview || undefined;
}

function collectFilePaths(value: unknown, target: Set<string>, depth = 0) {
  if (!value || depth > 4) return;

  const directPath = extractFilePath(value);
  if (directPath) target.add(directPath);

  if (Array.isArray(value)) {
    for (const item of value) collectFilePaths(item, target, depth + 1);
    return;
  }

  if (!isRecord(value)) return;

  for (const nested of Object.values(value)) {
    if (isRecord(nested) || Array.isArray(nested)) collectFilePaths(nested, target, depth + 1);
  }
}

function extractFileActivityPaths(event: any): string[] {
  const paths = new Set<string>();
  collectFilePaths(event?.args, paths);
  collectFilePaths(event?.result, paths);
  collectFilePaths(event?.output, paths);
  if (paths.size === 0) collectFilePaths(event, paths);
  return Array.from(paths).slice(0, 5);
}

function shouldRecordFileChange(toolName: string, event: any): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (['write', 'edit', 'apply_patch'].includes(normalized)) return true;
  if (/(write|edit|patch|save|create|update)/.test(normalized)) return true;
  if (event?.changed === true) return true;
  if (Array.isArray(event?.changedFiles) && event.changedFiles.length > 0) return true;
  return false;
}

function shouldSkipWorkspaceDir(name: string): boolean {
  if (WORKSPACE_SCAN_DIR_SKIP.has(name)) return true;
  if (name.startsWith('.') && !WORKSPACE_SCAN_HIDDEN_DIR_ALLOWLIST.has(name)) return true;
  return false;
}

function normalizeWorkspaceAgentIdFromDirName(dirName: string): string {
  if (dirName === 'workspace') return 'main';
  if (dirName.startsWith('workspace-')) return dirName.slice('workspace-'.length) || 'main';
  return dirName || 'main';
}

async function resolveWorkspaceRoots(agentFilter?: string): Promise<Array<{ agentId: string; path: string }>> {
  const { homedir } = await import('node:os');
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const homeDir = homedir();
  const openclawDir = join(homeDir, '.openclaw');
  const rootsByPath = new Map<string, { agentId: string; path: string; priority: number }>();

  const addRoot = (agentId: string | undefined | null, workspacePath: string | undefined | null, priority: number) => {
    const resolvedPath = resolveHomePath(workspacePath, homeDir);
    if (!resolvedPath) return;
    const resolvedAgentId = (agentId && agentId.trim()) || normalizeWorkspaceAgentIdFromDirName(resolvedPath.split('/').pop() || 'workspace');
    const existing = rootsByPath.get(resolvedPath);
    if (!existing || priority >= existing.priority) {
      rootsByPath.set(resolvedPath, { agentId: resolvedAgentId, path: resolvedPath, priority });
    }
  };

  addRoot('main', join(openclawDir, 'workspace'), 1);

  try {
    const entries = await readdir(openclawDir, { withFileTypes: true, encoding: 'utf8' });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name !== 'workspace' && !entry.name.startsWith('workspace-')) continue;
      addRoot(normalizeWorkspaceAgentIdFromDirName(entry.name), join(openclawDir, entry.name), 0);
    }
  } catch {
    // Ignore missing ~/.openclaw roots.
  }

  const config = cachedConfig || await readConfigFile();
  cachedConfig = config;
  const agentList = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  for (const agent of agentList) {
    const configuredAgentId =
      (typeof agent?.id === 'string' && agent.id)
      || (typeof agent?.name === 'string' && agent.name)
      || '';
    if (!configuredAgentId) continue;
    addRoot(configuredAgentId, agent?.workspace, 2);
    if (!agent?.workspace) {
      addRoot(configuredAgentId, join(openclawDir, configuredAgentId === 'main' ? 'workspace' : `workspace-${configuredAgentId}`), 1);
    }
  }

  const roots = Array.from(rootsByPath.values()).map(({ agentId, path }) => ({ agentId, path }));
  return agentFilter ? roots.filter((root) => root.agentId === agentFilter) : roots;
}

async function scanWorkspaceRoot(root: { agentId: string; path: string }, since: number): Promise<WorkspaceFileEntry[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join, relative, sep } = await import('node:path');

  const queue: Array<{ dir: string; depth: number }> = [{ dir: root.path, depth: 0 }];
  const entries: WorkspaceFileEntry[] = [];

  while (queue.length > 0 && entries.length < WORKSPACE_SCAN_MAX_RESULTS) {
    const current = queue.shift()!;
    let items;

    try {
      items = await readdir(current.dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }

    for (const item of items) {
      const fullPath = join(current.dir, item.name);

      if (item.isDirectory()) {
        if (current.depth < WORKSPACE_SCAN_MAX_DEPTH && !shouldSkipWorkspaceDir(item.name)) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!item.isFile()) continue;

      try {
        const fileStat = await stat(fullPath);
        if (fileStat.mtimeMs < since) continue;
        entries.push({
          name: item.name,
          path: relative(root.path, fullPath).split(sep).join('/'),
          size: fileStat.size,
          mtime: fileStat.mtimeMs,
          agentId: root.agentId,
          type: classifyWorkspaceFile(item.name),
        });
      } catch {
        // Ignore files that disappear during scan.
      }
    }
  }

  return entries;
}

async function refreshBuildings(): Promise<void> {
  const now = Date.now();
  if (now - buildingsLastRefresh < BUILDINGS_REFRESH_MS && cachedBuildings.length > 0) return;

  try {
    const config = await readConfigFile();
    cachedConfig = config;
    const buildings: KingdomBuilding[] = [];
    const { homedir } = await import('node:os');
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const homeDir = homedir();
    const agentList = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    const { items: skillItems, toolNames: skillToolNames, perAgent: perAgentSkills } = await scanSkills(config);

    // ── Global buildings (not owned by any agent) ──

    // 1. Channels (频道港口)
    const channelEntries = Object.entries(config.channels || {}) as [string, any][];
    buildings.push({
      id: 'channels', type: 'channel', name: '频道港口 Channels', icon: '📡',
      count: channelEntries.length,
      items: channelEntries.map(([name, channelConfig]) => {
        const status = channelStatuses.get(name);
        return {
          name,
          detail: channelConfig.baseUrl || '',
          status: status?.status ?? (channelConfig.enabled !== false ? 'connected' : 'disabled'),
        };
      }),
    });

    // 2. Models (模型熔炉)
    const providers = config.models?.providers || {};
    const providerEntries = Object.entries(providers) as [string, any][];
    const modelItems: KingdomBuildingItem[] = [];
    for (const [provName, provConfig] of providerEntries) {
      const endpoint = getProviderBaseUrl(provConfig);
      const defaultModel = getProviderDefaultModel(provConfig);
      modelItems.push({
        name: provName,
        detail: endpoint || defaultModel || '',
        status: defaultModel ? `default: ${defaultModel}` : undefined,
      });
    }
    buildings.push({
      id: 'models', type: 'model', name: '模型熔炉 Models', icon: '⚗️',
      count: modelItems.length,
      items: modelItems,
    });

    // 3. Plugins (插件工厂)
    const pluginEntries = Object.entries(config.plugins?.entries || {}) as [string, any][];
    buildings.push({
      id: 'plugins', type: 'plugin', name: '插件工厂 Plugins', icon: '🔌',
      count: pluginEntries.length,
      items: pluginEntries.map(([k, v]) => ({ name: k, status: v.enabled !== false ? 'active' : 'disabled' })),
    });

    // 4. Tools (工具库)
    buildings.push(await buildToolsBuilding(config, skillToolNames));

    // 5. Cron Jobs (时光钟塔)
    const cronJobs = await loadCronJobs();
    buildings.push({
      id: 'cron', type: 'cron', name: '时光钟塔 Cron', icon: '⏰',
      count: cronJobs.length,
      items: cronJobs.map((job) => ({
        name: getCronJobName(job),
        detail: formatCronSchedule(job?.schedule),
        status: getCronJobStatus(job),
      })),
    });

    // ── Per-agent buildings (skills, memory, files) ──

    // Resolve agent workspaces (main = default workspace)
    const agentWorkspaces: { id: string; workspace: string }[] = [
      { id: 'main', workspace: join(homeDir, '.openclaw', 'workspace') },
    ];
    for (const agentDef of agentList) {
      if (!agentDef?.id || agentDef.id === 'main') continue;
      const ws = resolveHomePath(agentDef.workspace, homeDir);
      if (ws) agentWorkspaces.push({ id: agentDef.id, workspace: ws });
    }

    for (const { id: agentId, workspace } of agentWorkspaces) {
      // Agent Skills
      const agentSkills = perAgentSkills.get(agentId) ?? [];
      buildings.push({
        id: `skills:${agentId}`, type: 'skill', name: '技能工坊 Skills', icon: '🛠️',
        count: agentSkills.length,
        items: agentSkills,
        agentId,
      });

      // Agent Memory
      const memoryItems: KingdomBuildingItem[] = [];
      try {
        const memDir = join(workspace, 'memory');
        const entries = await readdir(memDir);
        memoryItems.push(...entries.filter(f => f.endsWith('.md')).map(f => ({ name: f })));
      } catch { /* no memory dir */ }
      buildings.push({
        id: `memory:${agentId}`, type: 'memory', name: '记忆宝库 Memory', icon: '🧠',
        count: memoryItems.length,
        items: memoryItems,
        agentId,
      });

      // Agent Files (workspace .md files)
      let fileItems: KingdomBuildingItem[] = [];
      try {
        const entries = await readdir(workspace);
        fileItems = entries.filter(f => f.endsWith('.md')).map(f => ({ name: f }));
      } catch { /* no workspace */ }
      buildings.push({
        id: `files:${agentId}`, type: 'files', name: '领主档案 Files', icon: '📜',
        count: fileItems.length,
        items: fileItems,
        agentId,
      });
    }

    cachedBuildings = buildings;
    buildingsLastRefresh = now;
  } catch (err: any) {
    log.error?.(`[clawcraft] Failed to refresh buildings: ${err.message}`);
  }
}

function getWorldState(): WorldState {
  const now = Date.now();
  
  // Compute onboarding
  const onboardingProgress: OnboardingProgress = {
    hasChannel: channelStatuses.size > 0,
    hasRoute: Boolean(cachedConfig?.bindings && Object.keys(cachedConfig.bindings).length > 0),
    firstMessageSent: sessions.size > 0,
    agentCount: agents.size
  };

  // Compute overnight summary if idle > 4h
  let overnightSummary: OvernightSummary | undefined;
  if (now - lastUserAccess > 4 * 3600 * 1000) {
    overnightSummary = {
      since: lastUserAccess,
      cronRuns: { ...counters.cronRuns },
      channelEvents: [...counters.channelEvents],
      errors: [...counters.errors],
      tokenUsage: JSON.parse(JSON.stringify(counters.tokenUsage)),
      compactions: counters.compactions
    };
  }

  return {
    serverInstanceId,
    version: VERSION,
    uptime: Math.floor((now - startTime) / 1000),
    agents: Object.fromEntries(agents),
    sessions: Object.fromEntries(sessions),
    incidents: Array.from(incidents.values()),
    channels: Object.fromEntries(channelStatuses),
    buildings: cachedBuildings,
    onboardingProgress,
    overnightSummary,
    gatewayStatus: 'running',
  };
}

function ensureAgent(agentId: string, model?: string): AgentState {
  let agent = agents.get(agentId);
  if (!agent) {
    agent = {
      agentId, name: agentId, model: model || 'unknown', status: 'online',
      soulSummary: '', toolNames: [], skillIds: [], sessionKeys: [],
    };
    agents.set(agentId, agent);
    log.info?.(`[clawcraft] Agent created: ${agentId}`);
  }
  if (model && agent.model === 'unknown') agent.model = model;
  return agent;
}

function ensureSession(sessionKey: string, agentId: string): SessionState {
  let session = sessions.get(sessionKey);
  if (!session) {
    session = {
      sessionKey, sessionId: sessionKey, agentId, status: 'idle',
      runCount: 0, toolCallCount: 0, errorCount: 0, lastActivityTs: Date.now(),
    };
    sessions.set(sessionKey, session);
    const agent = ensureAgent(agentId);
    if (!agent.sessionKeys.includes(sessionKey)) agent.sessionKeys.push(sessionKey);
    broadcast({ type: 'session-created', session });
    log.info?.(`[clawcraft] Session created: ${sessionKey} → agent ${agentId}`);
  }
  return session;
}

function updateSession(sessionKey: string, changes: Partial<SessionState>) {
  const session = sessions.get(sessionKey);
  if (!session) return;
  Object.assign(session, changes);
  session.lastActivityTs = Date.now();
  broadcast({ type: 'session-update', sessionKey, changes });
}

function evictStaleInternal() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (session.status === 'ended' && now - session.lastActivityTs > EVICT_ENDED_AFTER_MS) {
      sessions.delete(key);
      const agent = agents.get(session.agentId);
      if (agent) agent.sessionKeys = agent.sessionKeys.filter(k => k !== key);
    }
  }
}

// ============================================================================
// Incident Management
// ============================================================================

function createIncidentInternal(source: { type: string; id: string }, type: string, title: string, detail: string, severity: IncidentSeverity) {
  const id = `${source.type}:${source.id}:${type}`;
  let incident = incidents.get(id);

  if (incident) {
    if (incident.status === 'resolved') incident.status = 'open';
    incident.lastSeen = Date.now();
    incident.count++;
    incident.detail = detail;
    broadcast({ type: 'incident-updated', id, changes: { status: 'open', lastSeen: incident.lastSeen, count: incident.count, detail } });
  } else {
    incident = {
      id, severity, source, title, detail,
      firstSeen: Date.now(), lastSeen: Date.now(), count: 1,
      status: 'open', blastRadius: [`${source.type}:${source.id}`],
      suggestedActions: []
    };
    
    // Auto-suggest actions
    if (type === 'rate_limit') {
      incident.suggestedActions.push({ label: '切换模型', actionType: 'agent.update', params: { agentId: source.id }, safety: '🟡' });
      incident.suggestedActions.push({ label: '暂停 Cron', actionType: 'cron.pause', params: {}, safety: '🟡' });
    }
    
    incidents.set(id, incident);
    broadcast({ type: 'incident-created', incident });
  }
}

// Auto-resolve check
setInterval(() => {
  const now = Date.now();
  for (const [id, inc] of incidents) {
    if (inc.status === 'open' && now - inc.lastSeen > AUTO_RESOLVE_MS) {
      inc.status = 'resolved';
      broadcast({ type: 'incident-updated', id, changes: { status: 'resolved' } });
    }
  }
}, 60_000);

// Channel Check
setInterval(() => {
  // Mock channel check - in real plugin we'd query gateway config/status
  for (const [id, ch] of channelStatuses) {
    if (Date.now() - ch.lastSeen > CHANNEL_CHECK_INTERVAL * 2) {
      if (ch.status !== 'disconnected') {
        ch.status = 'disconnected';
        createIncidentInternal({ type: 'channel', id }, 'disconnect', `${ch.name} 断开连接`, `Channel ${ch.name} heartbeat missing`, 'warning');
      }
    }
  }
}, CHANNEL_CHECK_INTERVAL);

// ============================================================================
// Hook Handlers
// ============================================================================

function hookBeforeAgentStart(event: any, context: any) {
  try {
    const agentId = context?.agentId || 'main';
    const sessionKey = context?.sessionKey || context?.sessionId || event?.sessionKey || event?.sessionId;
    if (!sessionKey) return;
    ensureSession(sessionKey, agentId);
    recordActivity({
      timestamp: Date.now(),
      agentId,
      sessionKey,
      type: 'message',
      summary: `${agentId} 开始新的运行`,
      detail: extractPromptPreview(event),
      metadata: {
        direction: 'system',
        phase: 'agent_start',
      },
    });
  } catch (err) { log.error?.(`[clawcraft] hookBeforeAgentStart error: ${err}`); }
}

function hookLlmInput(event: any, context: any) {
  try {
    const sessionKey = context?.sessionKey;
    if (!sessionKey) return;
    const agentId = resolveActivityAgentId(context, sessionKey);
    const session = ensureSession(sessionKey, agentId);
    if (event?.model) {
      const agent = agents.get(agentId);
      if (agent) agent.model = event.model;
    }
    updateSession(sessionKey, { status: 'thinking', runCount: session.runCount + 1 });
    recordActivity({
      timestamp: Date.now(),
      agentId,
      sessionKey,
      type: 'message',
      summary: `${agentId} 收到新消息`,
      detail: extractPromptPreview(event),
      metadata: {
        direction: 'user',
        phase: 'llm_input',
        model: event?.model,
        runCount: session.runCount + 1,
      },
    });
  } catch (err) { log.error?.(`[clawcraft] hookLlmInput error: ${err}`); }
}

function hookLlmOutput(event: any, context: any) {
  try {
    const sessionKey = context?.sessionKey;
    if (!sessionKey) return;
    const agentId = resolveActivityAgentId(context, sessionKey);
    const text = extractAssistantPreview(event);
    const errorMessage = extractErrorMessage(event?.error);

    // Incident detection
    if (event.error) {
      const isRateLimit = event.error.code === 429 || event.error.message?.includes('429');
      if (isRateLimit) {
        createIncidentInternal({ type: 'agent', id: agentId }, 'rate_limit', '模型限流 (429)', event.error.message, 'error');
      }
      counters.errors.push({ source: agentId, type: 'llm_error', count: 1, lastAt: Date.now() });
      recordActivity({
        timestamp: Date.now(),
        agentId,
        sessionKey,
        type: 'error',
        summary: `${agentId} 的模型调用失败`,
        detail: errorMessage,
        metadata: {
          phase: 'llm_output',
          model: event?.model,
          errorCode: event?.error?.code,
        },
      });
    }
    // Update token usage
    if (event.usage?.total_tokens) {
      counters.tokenUsage.total += event.usage.total_tokens;
      counters.tokenUsage.byAgent[agentId] = (counters.tokenUsage.byAgent[agentId] || 0) + event.usage.total_tokens;
    }

    updateSession(sessionKey, { status: 'responding', lastAssistantPreview: truncate(text, 400) });
    if (!event.error) {
      recordActivity({
        timestamp: Date.now(),
        agentId,
        sessionKey,
        type: 'message',
        summary: `${agentId} 生成回复`,
        detail: text,
        metadata: {
          direction: 'assistant',
          phase: 'llm_output',
          model: event?.model,
          tokens: event?.usage?.total_tokens,
          inputTokens: event?.usage?.input_tokens,
          outputTokens: event?.usage?.output_tokens,
        },
      });
    }
  } catch (err) { log.error?.(`[clawcraft] hookLlmOutput error: ${err}`); }
}

function hookBeforeToolCall(event: any, context: any) {
  try {
    const sessionKey = context?.sessionKey;
    if (!sessionKey) return;
    const agentId = resolveActivityAgentId(context, sessionKey);
    const toolName = normalizeToolNameFromEvent(event);
    const argsPreview = extractToolArgsPreview(event);
    updateSession(sessionKey, {
      status: 'tooling', currentTool: toolName,
      currentToolCategory: categorizeTool(toolName),
      currentToolArgsPreview: truncate(typeof event?.args === 'string' ? event.args : JSON.stringify(event?.args ?? ''), 120),
    });
    recordActivity({
      timestamp: Date.now(),
      agentId,
      sessionKey,
      type: 'tool_call',
      summary: `${agentId} 调用工具 ${toolName}`,
      detail: argsPreview,
      metadata: {
        toolName,
        phase: 'start',
        category: categorizeTool(toolName),
      },
    });
  } catch (err) { log.error?.(`[clawcraft] hookBeforeToolCall error: ${err}`); }
}

function hookAfterToolCall(event: any, context: any) {
  try {
    const sessionKey = context?.sessionKey;
    if (!sessionKey) return;
    const session = sessions.get(sessionKey);
    if (!session) return;
    const agentId = resolveActivityAgentId(context, sessionKey);
    const toolName = normalizeToolNameFromEvent(event);
    const resultPreview = extractToolResultPreview(event);
    const errorMessage = extractErrorMessage(event?.error);
    
    // Incident detection
    if (event.error) {
      createIncidentInternal({ type: 'session', id: sessionKey }, 'tool_error', '工具调用失败', event.error.message || 'Unknown tool error', 'warning');
      counters.toolErrors++;
      recordActivity({
        timestamp: Date.now(),
        agentId,
        sessionKey,
        type: 'error',
        summary: `${agentId} 的工具 ${toolName} 调用失败`,
        detail: errorMessage,
        metadata: {
          toolName,
          phase: 'end',
          status: 'error',
        },
      });
    } else {
      recordActivity({
        timestamp: Date.now(),
        agentId,
        sessionKey,
        type: 'tool_call',
        summary: `${agentId} 完成工具 ${toolName}`,
        detail: resultPreview,
        metadata: {
          toolName,
          phase: 'end',
          status: 'success',
        },
      });

      if (shouldRecordFileChange(toolName, event)) {
        for (const filePath of extractFileActivityPaths(event)) {
          recordActivity({
            timestamp: Date.now(),
            agentId,
            sessionKey,
            type: 'file_change',
            summary: `${agentId} 更新文件 ${filePath}`,
            detail: resultPreview,
            metadata: {
              toolName,
              path: filePath,
            },
          });
        }
      }
    }

    updateSession(sessionKey, {
      status: 'idle', currentTool: null, currentToolCategory: null,
      currentToolArgsPreview: null, toolCallCount: session.toolCallCount + 1,
    });
  } catch (err) { log.error?.(`[clawcraft] hookAfterToolCall error: ${err}`); }
}

function hookAgentEnd(event: any, context: any) {
  try {
    const sessionKey = context?.sessionKey;
    if (!sessionKey) return;
    const agentId = resolveActivityAgentId(context, sessionKey);
    updateSession(sessionKey, { status: 'idle' });
    recordActivity({
      timestamp: Date.now(),
      agentId,
      sessionKey,
      type: 'message',
      summary: `${agentId} 完成本轮执行`,
      detail: extractAssistantPreview(event) || sessions.get(sessionKey)?.lastAssistantPreview || undefined,
      metadata: {
        direction: 'system',
        phase: 'agent_end',
        status: 'idle',
      },
    });
  } catch (err) { log.error?.(`[clawcraft] hookAgentEnd error: ${err}`); }
}

function hookSubagentSpawned(event: any, context: any) {
  try {
    const childSessionKey = event?.childSessionKey || event?.sessionKey;
    const agentId = event?.agentId || context?.agentId || 'main';
    if (childSessionKey) {
      ensureSession(childSessionKey, agentId);
      recordActivity({
        timestamp: Date.now(),
        agentId,
        sessionKey: context?.sessionKey,
        type: 'subagent',
        summary: `${agentId} 生成子代理会话`,
        detail: childSessionKey,
        metadata: {
          childSessionKey,
          parentSessionKey: context?.sessionKey,
          phase: 'spawned',
        },
      });
    }
  } catch (err) { log.error?.(`[clawcraft] hookSubagentSpawned error: ${err}`); }
}

function hookSubagentEnded(event: any, context: any) {
  try {
    const childSessionKey = event?.childSessionKey || event?.sessionKey;
    if (childSessionKey && sessions.has(childSessionKey)) {
      const agentId = sessions.get(childSessionKey)?.agentId || resolveActivityAgentId(context, childSessionKey);
      updateSession(childSessionKey, { status: 'ended' });
      recordActivity({
        timestamp: Date.now(),
        agentId,
        sessionKey: childSessionKey,
        type: 'subagent',
        summary: `${agentId} 的子代理执行结束`,
        detail: extractErrorMessage(event?.error),
        metadata: {
          childSessionKey,
          parentSessionKey: context?.sessionKey,
          phase: 'ended',
        },
      });
    }
  } catch (err) { log.error?.(`[clawcraft] hookSubagentEnded error: ${err}`); }
}

// ============================================================================
// Shared HTTP Helpers
// ============================================================================

let runtimeApi: any = null;
let gatewayPort = 18789;
let gatewayAuthToken = '';

function jsonResponse(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function corsOptions(res: ServerResponse) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

async function readConfigFile(): Promise<any> {
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  return JSON.parse(await readFile(configPath, 'utf-8'));
}

async function writeConfigFile(config: any): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/** Internal HTTP request to Gateway's own API */
async function gatewayFetch(path: string, options: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ status: number; body: string }> {
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: gatewayPort,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayAuthToken}`,
        ...options.headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode || 500, body: data }));
    });
    req.setTimeout(options.timeoutMs ?? 8_000, () => {
      req.destroy(new Error(`Gateway request timed out after ${options.timeoutMs ?? 8_000}ms`));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/** Internal streaming HTTP request to Gateway — returns response object for piping */
async function gatewayStream(path: string, body: string): Promise<IncomingMessage> {
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: gatewayPort,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayAuthToken}`,
      },
    }, (res) => resolve(res as any));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function httpRequest(urlString: string, options: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[]>; url: string }> {
  const url = new URL(urlString);
  const transport = url.protocol === 'https:' ? await import('node:https') : await import('node:http');

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: options.headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({
        status: res.statusCode || 500,
        body: data,
        headers: res.headers as Record<string, string | string[]>,
        url: url.toString(),
      }));
    });

    req.setTimeout(options.timeoutMs ?? 5_000, () => {
      req.destroy(new Error(`Request timed out after ${options.timeoutMs ?? 5_000}ms`));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseJsonSafe(body: string): any {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function buildOpenAiCompatibleModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  // If baseUrl already ends with /v1 (e.g. Azure OpenAI), don't duplicate it
  if (/\/v1$/i.test(normalized)) return `${normalized}/models`;
  return `${normalized}/v1/models`;
}

// ============================================================================
// HTTP Route Handlers — Existing (health, state, events, config, action)
// ============================================================================

function handleHealth(_req: IncomingMessage, res: ServerResponse): boolean {
  const state = getWorldState();
  jsonResponse(res, 200, {
    ok: true, version: state.version, serverInstanceId: state.serverInstanceId,
    uptime: state.uptime, agents: Object.keys(state.agents).length,
    sessions: Object.keys(state.sessions).length, sseClients: sseClients.size,
  });
  return true;
}

function handleState(_req: IncomingMessage, res: ServerResponse): boolean {
  refreshBuildings().then(() => {
    jsonResponse(res, 200, getWorldState());
  }).catch(() => {
    jsonResponse(res, 200, getWorldState());
  });
  return true;
}

function handleEvents(req: IncomingMessage, res: ServerResponse): boolean {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
    'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ serverInstanceId })}\n\n`);
  sseClients.add(res);
  log.info?.(`[clawcraft] SSE client connected (total: ${sseClients.size})`);
  req.on('close', () => {
    sseClients.delete(res);
    log.info?.(`[clawcraft] SSE client disconnected (total: ${sseClients.size})`);
  });
  return true;
}

function handleConfig(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') { corsOptions(res); return true; }
  if (req.method !== 'GET') { jsonResponse(res, 405, { ok: false, error: 'Method not allowed' }); return true; }

  readConfigFile().then((config) => {
    const sanitized = JSON.parse(JSON.stringify(config));
    if (sanitized.models?.providers) {
      for (const p of Object.values(sanitized.models.providers) as any[]) {
        if (p.apiKey) p.apiKey = maskSecret(p.apiKey);
      }
    }
    if (sanitized.channels) {
      for (const [, ch] of Object.entries(sanitized.channels) as [string, any][]) {
        if (ch.botToken) ch.botToken = maskSecret(ch.botToken);
        if (ch.apiKey) ch.apiKey = maskSecret(ch.apiKey);
        if (ch.appToken) ch.appToken = maskSecret(ch.appToken);
        if (ch.accounts) {
          for (const acc of Object.values(ch.accounts) as any[]) {
            if ((acc as any).botToken) (acc as any).botToken = maskSecret((acc as any).botToken);
            if ((acc as any).apiKey) (acc as any).apiKey = maskSecret((acc as any).apiKey);
            if ((acc as any).appToken) (acc as any).appToken = maskSecret((acc as any).appToken);
          }
        }
      }
    }
    if (sanitized.gateway?.auth?.token) sanitized.gateway.auth.token = maskSecret(sanitized.gateway.auth.token);
    jsonResponse(res, 200, { ok: true, config: sanitized });
  }).catch((err) => {
    log.error?.(`[clawcraft] Config read error: ${err}`);
    jsonResponse(res, 500, { ok: false, error: 'Failed to read config' });
  });
  return true;
}

// ============================================================================
// NEW: Chat System — Real Gateway Integration
// ============================================================================

function handleChat(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url || '';

  if (req.method === 'OPTIONS') { corsOptions(res); return true; }

  // POST /clawcraft/chat/send — Send message to agent via Gateway
  if (req.method === 'POST' && url.endsWith('/send')) {
    readBody(req).then(async (body) => {
      try {
        const { sessionKey, agentId, message, stream, clientMessageId, clientTimestamp } = JSON.parse(body);
        if (!message) { jsonResponse(res, 400, { ok: false, error: 'Missing message' }); return; }

        const targetAgent = agentId || sessions.get(sessionKey)?.agentId || 'main';
        const targetSession = sessionKey || `clawcraft-${Date.now()}`;
        const userMessageTimestamp =
          typeof clientTimestamp === 'number' && Number.isFinite(clientTimestamp)
            ? clientTimestamp
            : Date.now();
        const userMessageId =
          typeof clientMessageId === 'string' && clientMessageId
            ? clientMessageId
            : `user-${userMessageTimestamp}`;
        const assistantTimestamp = Date.now();
        const assistantMessageId = `asst-${randomUUID()}`;
        ensureSession(targetSession, targetAgent);

        log.info?.(`[clawcraft] Chat → ${targetAgent}/${targetSession}: ${message.slice(0, 80)}`);

        // Broadcast user message to SSE clients
        broadcast({
          type: 'chat-message',
          sessionKey: targetSession,
          message: { role: 'user', content: message, timestamp: userMessageTimestamp, id: userMessageId },
        });

        if (stream !== false) {
          // Streaming mode: pipe SSE from Gateway to client
          res.writeHead(200, {
            'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
            'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
          });
          res.write(
            `data: ${JSON.stringify({
              type: 'session-meta',
              sessionKey: targetSession,
              agentId: targetAgent,
              assistantMessageId,
              assistantTimestamp,
            })}\n\n`,
          );

          try {
            const gwRes = await gatewayStream('/v1/chat/completions', JSON.stringify({
              model: `openclaw:${targetAgent}`,
              stream: true,
              messages: [{ role: 'user', content: message }],
              user: targetSession,
            }));

            let fullContent = '';
            let gatewayBuffer = '';

            const consumeGatewayText = (text: string) => {
              gatewayBuffer += text;
              const lines = gatewayBuffer.split(/\r?\n/);
              gatewayBuffer = lines.pop() ?? '';

              for (const line of lines) {
                if (!line.startsWith('data: ') || line === 'data: [DONE]') {
                  continue;
                }

                try {
                  const data = JSON.parse(line.slice(6));
                  const delta = data.choices?.[0]?.delta?.content;
                  if (typeof delta === 'string' && delta) {
                    fullContent += delta;
                  }
                } catch {
                  // Ignore partial or non-JSON SSE frames while mirroring the stream.
                }
              }
            };

            gwRes.on('data', (chunk: Buffer) => {
              const text = chunk.toString();
              consumeGatewayText(text);
              // Forward raw SSE to client
              res.write(text);
            });

            gwRes.on('end', () => {
              if (gatewayBuffer) {
                consumeGatewayText('\n');
              }
              res.write('data: [DONE]\n\n');
              res.end();

              // Broadcast complete assistant message to SSE clients
              if (fullContent) {
                broadcast({
                  type: 'chat-message',
                  sessionKey: targetSession,
                  message: {
                    role: 'assistant',
                    content: fullContent,
                    timestamp: assistantTimestamp,
                    id: assistantMessageId,
                  },
                });
              }
            });

            gwRes.on('error', (err: Error) => {
              log.error?.(`[clawcraft] Chat stream error: ${err.message}`);
              res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
              res.end();
            });
          } catch (err: any) {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
          }
        } else {
          // Non-streaming mode
          try {
            const gwResult = await gatewayFetch('/v1/chat/completions', {
              method: 'POST',
              body: JSON.stringify({
                model: `openclaw:${targetAgent}`,
                stream: false,
                messages: [{ role: 'user', content: message }],
                user: targetSession,
              }),
            });

            const data = JSON.parse(gwResult.body);
            const content = data.choices?.[0]?.message?.content || '';

            broadcast({
              type: 'chat-message',
              sessionKey: targetSession,
              message: { role: 'assistant', content, timestamp: Date.now(), id: `asst-${Date.now()}` },
            });

            jsonResponse(res, 200, { ok: true, content, sessionKey: targetSession });
          } catch (err: any) {
            jsonResponse(res, 500, { ok: false, error: `Chat failed: ${err.message}` });
          }
        }
      } catch (err: any) {
        jsonResponse(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    });
    return true;
  }

  // GET /clawcraft/chat/:sessionKey/history — Read session transcript
  if (req.method === 'GET' && url.includes('/history')) {
    const urlParts = url.replace('/clawcraft/chat/', '').split('/');
    const sessionKey = decodeURIComponent(urlParts[0]);

    readSessionHistory(sessionKey).then((messages) => {
      jsonResponse(res, 200, { ok: true, messages });
    }).catch((err) => {
      log.error?.(`[clawcraft] History error: ${err}`);
      jsonResponse(res, 200, { ok: true, messages: [] }); // Return empty instead of error
    });
    return true;
  }

  jsonResponse(res, 404, { error: 'Not found' });
  return true;
}

/** Read session transcript from disk */
async function readSessionHistory(sessionKey: string): Promise<any[]> {
  const { readFile, readdir } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');

  // Find the session directory — search all agents
  const agentsDir = join(homedir(), '.openclaw', 'agents');
  const messages: any[] = [];

  try {
    const agentDirs = await readdir(agentsDir);
    for (const agentId of agentDirs) {
      const sessionsDir = join(agentsDir, agentId, 'sessions');
      try {
        const sessionDirs = await readdir(sessionsDir);
        // Session dirs may be named by sessionKey (with special chars encoded)
        const matchingDir = sessionDirs.find(d => d === sessionKey || d.includes(sessionKey));
        if (matchingDir) {
          let transcriptPath = join(sessionsDir, matchingDir);

          // Check if it's a directory (v1 legacy) or file (v2 flat)
          const { stat } = await import('node:fs/promises');
          try {
            const stats = await stat(transcriptPath);
            if (stats.isDirectory()) {
               transcriptPath = join(transcriptPath, 'transcript.jsonl');
            }
          } catch { /* ignore */ }

          try {
            const content = await readFile(transcriptPath, 'utf-8');
            for (const line of content.split('\n').filter(Boolean)) {
              try {
                const entry = JSON.parse(line);
                if (entry.role === 'user' || entry.role === 'assistant') {
                  messages.push({
                    id: entry.id || `hist-${messages.length}`,
                    role: entry.role,
                    content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content),
                    timestamp: entry.timestamp || entry.ts || Date.now(),
                    toolName: entry.toolName,
                  });
                }
              } catch { /* skip malformed lines */ }
            }
          } catch { /* no transcript file */ }
          break;
        }
      } catch { /* agent has no sessions dir */ }
    }
  } catch { /* no agents dir */ }

  return messages;
}

// ============================================================================
// NEW: File Editor — SOUL.md / AGENTS.md / etc.
// ============================================================================

function handleFiles(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') { corsOptions(res); return true; }

  const url = new URL(req.url || '', `http://${req.headers.host}`);

  // GET /clawcraft/files?agentId=xxx&file=SOUL.md
  if (req.method === 'GET') {
    const agentId = url.searchParams.get('agentId') || 'main';
    const fileName = url.searchParams.get('file') || '';

    if (!fileName) {
      // List available files
      listAgentFiles(agentId).then((files) => {
        jsonResponse(res, 200, { ok: true, agentId, files });
      }).catch((err) => {
        jsonResponse(res, 500, { ok: false, error: err.message });
      });
      return true;
    }

    readAgentFile(agentId, fileName).then((content) => {
      jsonResponse(res, 200, { ok: true, agentId, file: fileName, content });
    }).catch((err) => {
      jsonResponse(res, 404, { ok: false, error: `File not found: ${err.message}` });
    });
    return true;
  }

  // POST /clawcraft/files — { agentId, file, content }
  if (req.method === 'POST') {
    readBody(req).then(async (body) => {
      try {
        const { agentId, file, content } = JSON.parse(body);
        if (!agentId || !file || content === undefined) {
          jsonResponse(res, 400, { ok: false, error: 'Missing agentId, file, or content' });
          return;
        }

        // Validate file name (only allow known config files)
        const allowedFiles = ['SOUL.md', 'AGENTS.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'BOOTSTRAP.md', 'HEARTBEAT.md'];
        if (!allowedFiles.includes(file)) {
          jsonResponse(res, 403, { ok: false, error: `File not allowed: ${file}. Allowed: ${allowedFiles.join(', ')}` });
          return;
        }

        await writeAgentFile(agentId, file, content);
        log.info?.(`[clawcraft] File written: ${agentId}/${file} (${content.length} bytes)`);

        broadcast({
          type: 'event',
          event: { type: 'info', message: `📝 ${file} 已更新 (${agentId})`, ts: Date.now() },
        });

        jsonResponse(res, 200, { ok: true, message: `${file} updated for agent ${agentId}` });
      } catch (err: any) {
        jsonResponse(res, 400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  jsonResponse(res, 405, { ok: false, error: 'Method not allowed' });
  return true;
}

async function resolveAgentWorkspace(agentId: string): Promise<string> {
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const { stat } = await import('node:fs/promises');

  // Try: agent-specific workspace from config
  try {
    const config = await readConfigFile();
    const agentList = config.agents?.list || [];
    const agentConfig = agentList.find((a: any) => a.id === agentId);
    if (agentConfig?.workspace) {
      const ws = agentConfig.workspace.replace('~', homedir());
      await stat(ws);
      return ws;
    }
  } catch { /* fall through */ }

  // Try: ~/.openclaw/agents/<agentId>/agent/ directory (only if it has .md files)
  const agentDir = join(homedir(), '.openclaw', 'agents', agentId, 'agent');
  try {
    const files = await (await import('node:fs/promises')).readdir(agentDir);
    if (files.some(f => f.endsWith('.md'))) return agentDir;
  } catch { /* fall through */ }

  // Fallback: default workspace (main agent uses this)
  const defaultWs = join(homedir(), '.openclaw', 'workspace');
  try { await stat(defaultWs); return defaultWs; } catch { /* fall through */ }

  return join(homedir(), '.openclaw', 'workspace');
}

async function listAgentFiles(agentId: string): Promise<{ name: string; size: number }[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const workspace = await resolveAgentWorkspace(agentId);
  const results: { name: string; size: number }[] = [];
  const targetFiles = ['SOUL.md', 'AGENTS.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'BOOTSTRAP.md', 'HEARTBEAT.md'];

  for (const name of targetFiles) {
    try {
      const s = await stat(join(workspace, name));
      results.push({ name, size: s.size });
    } catch { /* file doesn't exist, skip */ }
  }
  return results;
}

async function readAgentFile(agentId: string, fileName: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const workspace = await resolveAgentWorkspace(agentId);
  return readFile(join(workspace, fileName), 'utf-8');
}

async function writeAgentFile(agentId: string, fileName: string, content: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const workspace = await resolveAgentWorkspace(agentId);
  await writeFile(join(workspace, fileName), content, 'utf-8');
}



// ============================================================================
// NEW: Memory Management — via /tools/invoke
// ============================================================================

function handleMemory(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') { corsOptions(res); return true; }

  if (req.method !== 'POST') {
    jsonResponse(res, 405, { ok: false, error: 'Method not allowed' });
    return true;
  }

  readBody(req).then(async (body) => {
    try {
      const { action, agentId, ...params } = JSON.parse(body);

      if (!action) {
        jsonResponse(res, 400, { ok: false, error: 'Missing action (recall, store, forget, update)' });
        return;
      }

      // memory-core uses memory_search/memory_store; memory-lancedb-pro uses memory_recall
      // Try both tool names for maximum compatibility
      const toolMap: Record<string, string> = {
        recall: 'memory_search',
        store: 'memory_store',
        forget: 'memory_forget',
        update: 'memory_update',
      };

      const tool = toolMap[action];
      if (!tool) {
        jsonResponse(res, 400, { ok: false, error: `Unknown memory action: ${action}. Use: recall, store, forget, update` });
        return;
      }

      log.info?.(`[clawcraft] Memory ${action}: ${JSON.stringify(params).slice(0, 200)}`);

      // Use /tools/invoke to call the memory tool
      // sessionKey format: "agent:<agentId>:main" or just use "main" for default
      const sessionKey = agentId === 'main' ? 'main' : `agent:${agentId}:main`;
      const result = await gatewayFetch('/tools/invoke', {
        method: 'POST',
        body: JSON.stringify({
          tool,
          args: params,
          sessionKey,
        }),
      });

      const data = JSON.parse(result.body);
      jsonResponse(res, result.status, { ok: result.status === 200, ...data });
    } catch (err: any) {
      log.error?.(`[clawcraft] Memory error: ${err}`);
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
  });
  return true;
}

// ============================================================================
// NEW: Skills Management — via clawhub CLI
// ============================================================================

function handleSkills(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url || '';

  if (req.method === 'OPTIONS') { corsOptions(res); return true; }

  // GET /clawcraft/skills — list or search
  if (req.method === 'GET') {
    const urlObj = new URL(url, `http://${req.headers.host}`);
    const action = urlObj.searchParams.get('action') || 'list';

    if (action === 'search') {
      const query = urlObj.searchParams.get('q') || '';
      if (!query) { jsonResponse(res, 400, { ok: false, error: 'Missing q parameter' }); return true; }
      runClawHub(['search', query]).then(({ stdout, stderr, code }) => {
        if (code !== 0) { jsonResponse(res, 500, { ok: false, error: stderr || 'Search failed' }); return; }
        const skills = parseSearchOutput(stdout);
        jsonResponse(res, 200, { ok: true, skills });
      });
      return true;
    }

    // Default: list installed
    runClawHub(['list']).then(({ stdout, stderr, code }) => {
      if (code !== 0) { jsonResponse(res, 200, { ok: true, skills: [], error: stderr }); return; }
      const skills = parseListOutput(stdout);
      jsonResponse(res, 200, { ok: true, skills });
    });
    return true;
  }

  // POST /clawcraft/skills — install / uninstall
  if (req.method === 'POST') {
    readBody(req).then(async (body) => {
      try {
        const { action, slug, version } = JSON.parse(body);

        if (action === 'install') {
          if (!slug) { jsonResponse(res, 400, { ok: false, error: 'Missing slug' }); return; }
          const args = ['install', slug];
          if (version) args.push('--version', version);
          log.info?.(`[clawcraft] Installing skill: ${slug}${version ? '@' + version : ''}`);
          const { stdout, stderr, code } = await runClawHub(args);
          if (code !== 0) {
            jsonResponse(res, 500, { ok: false, error: stderr || 'Install failed' });
            return;
          }
          broadcast({ type: 'event', event: { type: 'info', message: `🏗️ 新建筑落成: ${slug}`, ts: Date.now() } });
          jsonResponse(res, 200, { ok: true, message: `Skill ${slug} installed`, output: stdout });
        } else if (action === 'uninstall' || action === 'remove') {
          if (!slug) { jsonResponse(res, 400, { ok: false, error: 'Missing slug' }); return; }
          // clawhub doesn't have uninstall — we trash the directory
          const { homedir } = await import('node:os');
          const { join } = await import('node:path');
          const { rm } = await import('node:fs/promises');
          const skillDir = join(homedir(), '.openclaw', 'workspace', 'skills', slug);
          try {
            await rm(skillDir, { recursive: true });
            broadcast({ type: 'event', event: { type: 'info', message: `🗑️ 建筑拆除: ${slug}`, ts: Date.now() } });
            jsonResponse(res, 200, { ok: true, message: `Skill ${slug} removed` });
          } catch (err: any) {
            jsonResponse(res, 500, { ok: false, error: `Remove failed: ${err.message}` });
          }
        } else if (action === 'update') {
          const args = slug ? ['update', slug] : ['update', '--all', '--no-input'];
          log.info?.(`[clawcraft] Updating skills: ${slug || 'all'}`);
          const { stdout, stderr, code } = await runClawHub(args);
          if (code !== 0) {
            jsonResponse(res, 500, { ok: false, error: stderr || 'Update failed' });
            return;
          }
          broadcast({ type: 'event', event: { type: 'info', message: `🔄 技能升级完成: ${slug || '全部'}`, ts: Date.now() } });
          jsonResponse(res, 200, { ok: true, message: `Skills updated`, output: stdout });
        } else {
          jsonResponse(res, 400, { ok: false, error: `Unknown action: ${action}. Use: install, uninstall, update` });
        }
      } catch (err: any) {
        jsonResponse(res, 400, { ok: false, error: `Invalid JSON: ${err.message}` });
      }
    });
    return true;
  }

  jsonResponse(res, 405, { ok: false, error: 'Method not allowed' });
  return true;
}

/** Run clawhub CLI command */
async function runClawHub(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const { execFile } = await import('node:child_process');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');

  // Find clawhub binary
  const possiblePaths = [
    join(homedir(), '.npm-global', 'bin', 'clawhub'),
    '/usr/local/bin/clawhub',
    '/usr/bin/clawhub',
  ];

  let clawhubBin = 'clawhub';
  const { existsSync } = await import('node:fs');
  for (const p of possiblePaths) {
    if (existsSync(p)) { clawhubBin = p; break; }
  }

  return new Promise((resolve) => {
    execFile(clawhubBin, args, {
      timeout: 30_000,
      env: { ...process.env, PATH: `${join(homedir(), '.npm-global', 'bin')}:${process.env.PATH}` },
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || err?.message || '',
        code: err ? (err as any).code || 1 : 0,
      });
    });
  });
}

/** Parse clawhub search output: "slug  Name  (score)" per line */
function parseSearchOutput(output: string): { slug: string; name: string; score?: string }[] {
  const results: { slug: string; name: string; score?: string }[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('Searching')) continue;
    // Format: "slug  Name  (score)"
    const match = trimmed.match(/^(\S+)\s+(.+?)\s+\(([^)]+)\)\s*$/);
    if (match) {
      results.push({ slug: match[1], name: match[2].trim(), score: match[3] });
    } else {
      // Fallback: just slug
      const parts = trimmed.split(/\s{2,}/);
      results.push({ slug: parts[0], name: parts[1] || parts[0] });
    }
  }
  return results;
}

/** Parse clawhub list output */
function parseListOutput(output: string): { slug: string; version?: string; path?: string }[] {
  const results: { slug: string; version?: string; path?: string }[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.toLowerCase().includes('no ') || trimmed.toLowerCase().includes('installed skills')) continue;
    const parts = trimmed.split(/\s{2,}/);
    if (parts[0]) results.push({ slug: parts[0], version: parts[1], path: parts[2] });
  }
  return results;
}

// ============================================================================
// Action System (extended)
// ============================================================================

function handleAction(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') { corsOptions(res); return true; }
  if (req.method !== 'POST') { jsonResponse(res, 405, { ok: false, error: 'Method not allowed' }); return true; }

  readBody(req).then(async (body) => {
    try {
      const action = JSON.parse(body);
      log.info?.(`[clawcraft] Action: ${action.type} ${JSON.stringify(action.params || {}).slice(0, 200)}`);
      const result = await executeAction(action);
      jsonResponse(res, result.ok ? 200 : 400, result);
    } catch (err: any) {
      log.error?.(`[clawcraft] Action error: ${err}`);
      jsonResponse(res, 500, { ok: false, error: err.message || 'Action failed' });
    }
  });
  return true;
}

interface ActionRequest { type: string; params: Record<string, any>; }
interface ActionResult { ok: boolean; message?: string; data?: any; error?: string; }

// ── Skill Test ──
function actionSkillTest(params: any): ActionResult {
  const { slug } = params || {};
  if (!slug) return { ok: false, error: 'Missing slug' };
  const { homedir } = require('node:os');
  const { join } = require('node:path');
  const fs = require('fs');
  // Search multiple possible skill locations
  const searchPaths = [
    join(homedir(), '.openclaw', 'workspace', 'skills', slug),
    join(homedir(), '.openclaw', 'skills', slug),
    `/usr/lib/node_modules/openclaw/skills/${slug}`,
    `/usr/local/lib/node_modules/openclaw/skills/${slug}`,
    join(homedir(), '.npm-global', 'lib', 'node_modules', 'openclaw', 'skills', slug),
  ];
  for (const p of searchPaths) {
    try {
      if (fs.statSync(p).isDirectory()) {
        // Check for SKILL.md
        const hasSkillMd = fs.existsSync(join(p, 'SKILL.md'));
        return { ok: true, message: `技能 ${slug} 存在 (${p})${hasSkillMd ? ' ✓ SKILL.md' : ' ⚠️ 无SKILL.md'}` };
      }
    } catch { /* continue */ }
  }
  return { ok: false, error: `技能 ${slug} 在所有已知路径中未找到` };
}

// ── Model Test ──
async function actionModelTest(params: any): Promise<ActionResult> {
  const { provider } = params || {};
  if (!provider) return { ok: false, error: 'Missing provider name' };

  try {
    const cfg = await readConfigFile();
    const providerConfig = cfg?.models?.providers?.[provider];
    if (!providerConfig) return { ok: false, error: `提供商 ${provider} 未配置` };

    const requestConfig = resolveProviderModelsRequest(provider, providerConfig);
    if (!requestConfig) return { ok: false, error: `提供商 ${provider} 缺少可测试的 endpoint 或 apiKey` };

    const startedAt = Date.now();
    const response = await httpRequest(requestConfig.url, {
      method: 'GET',
      headers: requestConfig.headers,
      timeoutMs: 15_000,
    });
    const latencyMs = Date.now() - startedAt;
    const payload = parseJsonSafe(response.body);
    const modelCount = Array.isArray(payload?.data)
      ? payload.data.length
      : Array.isArray(payload?.models)
        ? payload.models.length
        : Array.isArray(payload)
          ? payload.length
          : undefined;

    if (response.status < 200 || response.status >= 300) {
      const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      return {
        ok: false,
        error: `连接失败: ${message}`,
        data: { latencyMs, endpoint: requestConfig.url, status: response.status },
      };
    }

    const suffix = modelCount !== undefined ? `，发现 ${modelCount} 个模型` : '';
    return {
      ok: true,
      message: `连接成功 (${latencyMs}ms)${suffix}`,
      data: { latencyMs, modelCount, endpoint: requestConfig.url, status: response.status },
    };
  } catch (err: any) {
    return { ok: false, error: `读取配置失败: ${err.message}` };
  }
}

function resolveProviderModelsRequest(providerName: string, providerConfig: any): { url: string; headers: Record<string, string> } | null {
  const apiKey = typeof providerConfig?.apiKey === 'string' ? providerConfig.apiKey : '';
  const baseUrl = getProviderBaseUrl(providerConfig);
  const canonicalProvider = providerName.toLowerCase();

  if (baseUrl) {
    if (!apiKey) return null;
    const authMode = providerConfig?.auth === 'api-key' ? 'api-key' : 'bearer';
    const headers: Record<string, string> = authMode === 'api-key'
      ? { 'api-key': apiKey }
      : { Authorization: `Bearer ${apiKey}` };
    return { url: buildOpenAiCompatibleModelsUrl(baseUrl), headers };
  }

  const preset = PROVIDER_DEFAULTS[canonicalProvider];
  if (!preset || !apiKey) return null;

  if (preset.auth === 'google-query') {
    const separator = preset.url.includes('?') ? '&' : '?';
    return { url: `${preset.url}${separator}key=${encodeURIComponent(apiKey)}`, headers: { ...(preset.headers || {}) } };
  }

  if (preset.auth === 'api-key') {
    return {
      url: preset.url,
      headers: {
        'x-api-key': apiKey,
        ...(preset.headers || {}),
      },
    };
  }

  return {
    url: preset.url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(preset.headers || {}),
    },
  };
}

function applyProviderFields(providerConfig: any, updates: Record<string, any>, mode: 'add' | 'update') {
  if (mode === 'add') {
    providerConfig.auth = providerConfig.auth || 'bearer';
    providerConfig.api = providerConfig.api || 'openai-completions';
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'baseUrl')) {
    const value = String(updates.baseUrl || '').trim();
    if (value) providerConfig.baseUrl = value;
    else delete providerConfig.baseUrl;
    delete providerConfig.baseURL;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'apiKey')) {
    const value = String(updates.apiKey || '').trim();
    if (value) providerConfig.apiKey = value;
    else if (mode === 'add') delete providerConfig.apiKey;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'defaultModel')) {
    const value = String(updates.defaultModel || '').trim();
    if (value) {
      providerConfig.defaultModel = value;
      if (Array.isArray(providerConfig.models)) {
        providerConfig.models = [value, ...providerConfig.models.filter((entry: unknown) => typeof entry === 'string' && entry !== value)];
      } else if (isRecord(providerConfig.models)) {
        providerConfig.models.default = value;
      } else {
        providerConfig.models = [value];
      }
    } else {
      delete providerConfig.defaultModel;
      if (isRecord(providerConfig.models) && Object.prototype.hasOwnProperty.call(providerConfig.models, 'default')) {
        delete providerConfig.models.default;
      }
    }
  }
}

async function actionModelAdd(params: any): Promise<ActionResult> {
  const name = typeof params?.name === 'string' ? params.name.trim() : '';
  if (!name) return { ok: false, error: 'Missing provider name' };

  try {
    const config = await readConfigFile();
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    if (config.models.providers[name]) return { ok: false, error: `提供商 ${name} 已存在` };

    const providerConfig: Record<string, any> = {};
    applyProviderFields(providerConfig, params || {}, 'add');
    config.models.providers[name] = providerConfig;
    await writeConfigFile(config);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});

    return {
      ok: true,
      message: `提供商 ${name} 已添加`,
      data: { needsRestart: true },
    };
  } catch (err: any) {
    return { ok: false, error: `添加失败: ${err.message}` };
  }
}

async function actionModelUpdate(params: any): Promise<ActionResult> {
  const provider = typeof params?.provider === 'string' ? params.provider.trim() : '';
  if (!provider) return { ok: false, error: 'Missing provider name' };

  try {
    const config = await readConfigFile();
    const providerConfig = config.models?.providers?.[provider];
    if (!providerConfig) return { ok: false, error: `提供商 ${provider} 不存在` };

    applyProviderFields(providerConfig, params || {}, 'update');
    await writeConfigFile(config);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});

    return {
      ok: true,
      message: `提供商 ${provider} 已更新`,
      data: { needsRestart: true },
    };
  } catch (err: any) {
    return { ok: false, error: `更新失败: ${err.message}` };
  }
}

async function actionModelRemove(params: any): Promise<ActionResult> {
  const provider = typeof params?.provider === 'string' ? params.provider.trim() : '';
  if (!provider) return { ok: false, error: 'Missing provider name' };

  try {
    const config = await readConfigFile();
    if (!config.models?.providers?.[provider]) return { ok: false, error: `提供商 ${provider} 不存在` };
    delete config.models.providers[provider];
    await writeConfigFile(config);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});

    return {
      ok: true,
      message: `提供商 ${provider} 已删除`,
      data: { needsRestart: true },
    };
  } catch (err: any) {
    return { ok: false, error: `删除失败: ${err.message}` };
  }
}

// ── Plugin Toggle ──
async function actionPluginToggle(params: any): Promise<ActionResult> {
  const { pluginId, enabled } = params || {};
  if (!pluginId) return { ok: false, error: 'Missing pluginId' };
  try {
    const config = await readConfigFile();
    if (!config.plugins?.entries?.[pluginId]) return { ok: false, error: `插件 ${pluginId} 不存在` };
    config.plugins.entries[pluginId].enabled = enabled;
    await writeConfigFile(config);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    return { ok: true, message: `插件 ${pluginId} 已${enabled ? '启用' : '停用'}（重启 Gateway 后生效）` };
  } catch (err: any) {
    return { ok: false, error: `操作失败: ${err.message}` };
  }
}

async function actionCronList(): Promise<ActionResult> {
  const jobs = await loadCronJobs();
  return { ok: true, data: { jobs } };
}

async function actionCronRuns(params: any): Promise<ActionResult> {
  const jobId = typeof params?.jobId === 'string' ? params.jobId.trim() : '';
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  const limit = typeof params?.limit === 'number' && Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit))
    : 20;

  const runs = await loadCronRuns(jobId, limit);
  return { ok: true, data: { runs } };
}

function parseEveryMs(expr: string): number | null {
  const m = expr.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === 's' || unit === 'sec') return n * 1000;
  if (unit === 'm' || unit === 'min') return n * 60_000;
  if (unit === 'h' || unit === 'hr') return n * 3_600_000;
  if (unit === 'd' || unit === 'day') return n * 86_400_000;
  return null;
}

async function actionCronAdd(params: any): Promise<ActionResult> {
  const { randomUUID } = await import('node:crypto');
  const scheduleKind = typeof params?.scheduleKind === 'string' ? params.scheduleKind : '';
  const scheduleValue = params?.scheduleValue !== undefined && params?.scheduleValue !== null ? String(params.scheduleValue).trim() : '';
  const sessionTarget = params?.sessionTarget === 'main' ? 'main' : 'isolated';
  const message = typeof params?.message === 'string' ? params.message.trim() : '';
  const name = typeof params?.name === 'string' ? params.name.trim() : '';

  if (!scheduleKind || !scheduleValue) return { ok: false, error: 'Missing schedule' };
  if (!message) return { ok: false, error: 'Missing message' };

  // Build schedule object
  const now = Date.now();
  let schedule: any;
  if (scheduleKind === 'every') {
    const ms = parseEveryMs(scheduleValue);
    if (!ms) return { ok: false, error: `Invalid interval: ${scheduleValue}` };
    schedule = { kind: 'every', everyMs: ms, anchorMs: now };
  } else if (scheduleKind === 'cron') {
    schedule = { kind: 'cron', expression: scheduleValue };
    if (params?.tz) schedule.tz = String(params.tz);
  } else if (scheduleKind === 'at') {
    const atMs = new Date(scheduleValue).getTime();
    if (isNaN(atMs)) return { ok: false, error: `Invalid date: ${scheduleValue}` };
    schedule = { kind: 'at', atMs };
  } else {
    return { ok: false, error: `Unsupported schedule kind: ${scheduleKind}` };
  }

  // Build job object (same structure as openclaw cron add)
  const job: any = {
    id: randomUUID(),
    name: name || message.slice(0, 40),
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    schedule,
    sessionTarget,
    wakeMode: params?.wakeMode === 'next-heartbeat' ? 'next-heartbeat' : 'now',
    payload: sessionTarget === 'main'
      ? { kind: 'systemEvent', event: message }
      : { kind: 'agentTurn', message },
    delivery: { mode: params?.announce ? 'announce' : 'announce', channel: params?.channel || 'last' },
    state: {},
  };
  if (params?.to) job.delivery.to = String(params.to);
  if (params?.agentId) job.agentId = String(params.agentId);
  if (params?.model && sessionTarget !== 'main') job.model = String(params.model);
  if (params?.thinking && sessionTarget !== 'main') job.thinking = String(params.thinking);
  if (params?.lightContext && sessionTarget !== 'main') job.lightContext = true;
  if (params?.deleteAfterRun) job.deleteAfterRun = true;

  // Compute nextRunAtMs
  if (schedule.kind === 'every') {
    job.state.nextRunAtMs = now + schedule.everyMs;
  } else if (schedule.kind === 'at') {
    job.state.nextRunAtMs = schedule.atMs;
  }
  // cron kind: gateway computes nextRunAtMs on load

  try {
    const jobs = await loadCronJobs();
    jobs.push(job);
    await writeCronJobs(jobs);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    return { ok: true, message: '已创建 Cron Job', data: { jobId: job.id } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to add cron job' };
  }
}

async function actionCronToggle(params: any): Promise<ActionResult> {
  const jobId = typeof params?.jobId === 'string' ? params.jobId.trim() : '';
  const enabled = params?.enabled;
  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (typeof enabled !== 'boolean') return { ok: false, error: 'Missing enabled flag' };

  try {
    const jobs = await loadCronJobs();
    const job = jobs.find((j: any) => j.id === jobId);
    if (!job) return { ok: false, error: 'Job not found' };
    job.enabled = enabled;
    job.updatedAtMs = Date.now();
    await writeCronJobs(jobs);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    return { ok: true, message: `Cron Job 已${enabled ? '启用' : '停用'}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to toggle cron job' };
  }
}

async function actionCronRun(params: any): Promise<ActionResult> {
  const jobId = typeof params?.jobId === 'string' ? params.jobId.trim() : '';
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  try {
    const output = await runCronCli(['run', jobId], 30_000);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    return { ok: true, message: 'Cron Job 已执行', data: { output } };
  } catch (err: any) {
    return { ok: false, error: err?.stderr?.toString?.().trim() || err?.message || 'Failed to run cron job' };
  }
}

async function actionCronRemove(params: any): Promise<ActionResult> {
  const jobId = typeof params?.jobId === 'string' ? params.jobId.trim() : '';
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  try {
    const jobs = await loadCronJobs();
    const idx = jobs.findIndex((j: any) => j.id === jobId);
    if (idx < 0) return { ok: false, error: 'Job not found' };
    jobs.splice(idx, 1);
    await writeCronJobs(jobs);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    return { ok: true, message: 'Cron Job 已删除' };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to remove cron job' };
  }
}

async function executeAction(action: ActionRequest): Promise<ActionResult> {
  switch (action.type) {
    case 'channel.add': return actionChannelAdd(action.params);
    case 'channel.remove': return actionChannelRemove(action.params);
    case 'channel.update': return actionChannelUpdate(action.params);
    case 'channel.test': return actionChannelTest(action.params);
    case 'agent.update': return actionAgentUpdate(action.params);
    case 'agent.tools.update': return actionAgentToolsUpdate(action.params);
    case 'config.update': return actionConfigUpdate(action.params);
    case 'gateway.restart': return actionGatewayRestart();
    case 'session.new': return actionSessionNew(action.params);
    case 'session.compact': return actionSessionCompact(action.params);
    case 'session.reset': return actionSessionReset(action.params);
    case 'incident.ack': return actionIncidentUpdate(action.params, 'acked');
    case 'incident.resolve': return actionIncidentUpdate(action.params, 'resolved');
    case 'incident.mute': return actionIncidentUpdate(action.params, 'muted');
    case 'skill.test': return actionSkillTest(action.params);
    case 'model.test': return actionModelTest(action.params);
    case 'model.add': return actionModelAdd(action.params);
    case 'model.update': return actionModelUpdate(action.params);
    case 'model.remove': return actionModelRemove(action.params);
    case 'plugin.toggle': return await actionPluginToggle(action.params);
    case 'cron.list': return actionCronList();
    case 'cron.runs': return actionCronRuns(action.params);
    case 'cron.add': return actionCronAdd(action.params);
    case 'cron.toggle': return actionCronToggle(action.params);
    case 'cron.run': return actionCronRun(action.params);
    case 'cron.remove': return actionCronRemove(action.params);
    case 'layout.save': return actionLayoutSave(action.params);
    case 'layout.load': return actionLayoutLoad();
    default: return { ok: false, error: `Unknown action type: ${action.type}` };
  }
}

function actionIncidentUpdate(params: any, status: IncidentStatus): ActionResult {
  const incident = incidents.get(params.id);
  if (!incident) return { ok: false, error: 'Incident not found' };
  incident.status = status;
  broadcast({ type: 'incident-updated', id: params.id, changes: { status } });
  return { ok: true, message: `Incident ${status}` };
}

async function actionChannelTest(params: any): Promise<ActionResult> {
  const channelType = typeof params?.channelType === 'string'
    ? params.channelType
    : typeof params?.channel === 'string'
      ? params.channel
      : '';
  if (!channelType) return { ok: false, error: 'Missing channelType' };

  try {
    const config = await readConfigFile();
    const channelConfig = config.channels?.[channelType];
    if (!channelConfig) return { ok: false, error: `频道 ${channelType} 未配置` };

    const startedAt = Date.now();
    let response: { status: number; body: string; headers: Record<string, string | string[]>; url: string };

    if (channelType === 'mattermost') {
      if (!channelConfig.baseUrl) return { ok: false, error: 'Mattermost 缺少 baseUrl' };
      response = await httpRequest(`${normalizeBaseUrl(channelConfig.baseUrl)}/api/v4/system/ping`, { timeoutMs: 5_000 });
    } else if (channelType === 'telegram') {
      if (!channelConfig.botToken) return { ok: false, error: 'Telegram 缺少 botToken' };
      response = await httpRequest(`https://api.telegram.org/bot${encodeURIComponent(channelConfig.botToken)}/getMe`, { timeoutMs: 5_000 });
    } else if (channelType === 'discord') {
      if (!channelConfig.botToken) return { ok: false, error: 'Discord 缺少 botToken' };
      response = await httpRequest('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${channelConfig.botToken}` },
        timeoutMs: 5_000,
      });
    } else if (channelType === 'slack') {
      if (!channelConfig.botToken) return { ok: false, error: 'Slack 缺少 botToken' };
      response = await httpRequest('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${channelConfig.botToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: '',
        timeoutMs: 5_000,
      });
    } else {
      if (!channelConfig.baseUrl) return { ok: false, error: `${channelType} 缺少 baseUrl` };
      response = await httpRequest(channelConfig.baseUrl, { method: 'HEAD', timeoutMs: 5_000 });
    }

    const latencyMs = Date.now() - startedAt;
    const payload = parseJsonSafe(response.body);
    const bodyOk = channelType === 'telegram'
      ? payload?.ok === true
      : channelType === 'slack'
        ? payload?.ok === true
        : response.status >= 200 && response.status < 300;

    const ok = response.status >= 200 && response.status < 300 && bodyOk;
    channelStatuses.set(channelType, {
      name: channelType,
      type: channelType,
      status: ok ? 'connected' : 'error',
      lastSeen: Date.now(),
      messageCount: channelStatuses.get(channelType)?.messageCount || 0,
    });
    buildingsLastRefresh = 0;

    if (ok) {
      return {
        ok: true,
        message: `${channelType} 连接成功 (${latencyMs}ms)`,
        data: { latencyMs, status: response.status, endpoint: response.url },
      };
    }

    const errorMessage = payload?.error || payload?.description || payload?.message || `HTTP ${response.status}`;
    return {
      ok: false,
      error: `${channelType} 连接失败: ${errorMessage}`,
      data: { latencyMs, status: response.status, endpoint: response.url },
    };
  } catch (err: any) {
    channelStatuses.set(channelType, {
      name: channelType,
      type: channelType,
      status: 'error',
      lastSeen: Date.now(),
      messageCount: channelStatuses.get(channelType)?.messageCount || 0,
    });
    buildingsLastRefresh = 0;
    return { ok: false, error: `${channelType} 连接失败: ${err.message}` };
  }
}

async function actionChannelAdd(params: any): Promise<ActionResult> {
  const { channelType, config: channelConfig } = params;
  if (!channelType || !channelConfig) return { ok: false, error: 'Missing channelType or config' };
  try {
    const config = await readConfigFile();
    if (!config.channels) config.channels = {};
    if (config.channels[channelType]) return { ok: false, error: `Channel ${channelType} already exists.` };
    config.channels[channelType] = { enabled: true, ...channelConfig };
    if (!config.plugins) config.plugins = {};
    if (!config.plugins.entries) config.plugins.entries = {};
    config.plugins.entries[channelType] = { enabled: true };
    await writeConfigFile(config);
    channelStatuses.set(channelType, {
      name: channelType,
      type: channelType,
      status: channelConfig.enabled !== false ? 'connected' : 'disconnected',
      lastSeen: Date.now(),
      messageCount: channelStatuses.get(channelType)?.messageCount || 0,
    });
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    broadcast({ type: 'event', event: { type: 'info', message: `🏗️ 新港口建造完成: ${channelType}`, ts: Date.now() } });
    return { ok: true, message: `Channel ${channelType} added. Gateway restart required.`, data: { needsRestart: true } };
  } catch (err: any) { return { ok: false, error: `Failed: ${err.message}` }; }
}

async function actionChannelRemove(params: any): Promise<ActionResult> {
  const { channelType } = params;
  if (!channelType) return { ok: false, error: 'Missing channelType' };
  try {
    const config = await readConfigFile();
    if (!config.channels?.[channelType]) return { ok: false, error: `Channel ${channelType} not found` };
    delete config.channels[channelType];
    if (config.plugins?.entries?.[channelType]) config.plugins.entries[channelType].enabled = false;
    await writeConfigFile(config);
    channelStatuses.delete(channelType);
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    broadcast({ type: 'event', event: { type: 'info', message: `🗑️ 港口拆除: ${channelType}`, ts: Date.now() } });
    return { ok: true, message: `Channel ${channelType} removed.`, data: { needsRestart: true } };
  } catch (err: any) { return { ok: false, error: `Failed: ${err.message}` }; }
}

async function actionChannelUpdate(params: any): Promise<ActionResult> {
  const { channelType, config: updates } = params;
  if (!channelType || !updates) return { ok: false, error: 'Missing channelType or config' };
  try {
    const config = await readConfigFile();
    if (!config.channels?.[channelType]) return { ok: false, error: `Channel ${channelType} not found` };
    config.channels[channelType] = mergeMaskedValues(config.channels[channelType], updates);
    await writeConfigFile(config);
    if (channelStatuses.has(channelType)) {
      const current = channelStatuses.get(channelType)!;
      current.status = config.channels[channelType].enabled !== false ? current.status : 'disconnected';
      current.lastSeen = Date.now();
    }
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    return { ok: true, message: `Channel ${channelType} updated.`, data: { needsRestart: true } };
  } catch (err: any) { return { ok: false, error: `Failed: ${err.message}` }; }
}

async function actionAgentUpdate(params: any): Promise<ActionResult> {
  const { agentId, updates } = params;
  if (!agentId || !updates) return { ok: false, error: 'Missing agentId or updates' };
  try {
    const config = await readConfigFile();
    const agentList = config.agents?.list || [];
    const idx = agentList.findIndex((a: any) => a.id === agentId);
    if (idx === -1) return { ok: false, error: `Agent ${agentId} not found` };
    const currentAgent = agentList[idx];
    const nextAgent = { ...currentAgent };
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'identity' && isRecord(value)) {
        nextAgent.identity = { ...(isRecord(currentAgent.identity) ? currentAgent.identity : {}), ...value };
      } else {
        nextAgent[key] = value;
      }
    }
    agentList[idx] = nextAgent;
    await writeConfigFile(config);

    const agent = agents.get(agentId);
    if (agent) {
      if (typeof nextAgent.model === 'string' && nextAgent.model) agent.model = nextAgent.model;
      const displayName = getAgentDisplayName(nextAgent);
      if (displayName) agent.name = displayName;
    }

    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    return { ok: true, message: `Agent ${agentId} updated.` };
  } catch (err: any) { return { ok: false, error: `Failed: ${err.message}` }; }
}

async function actionAgentToolsUpdate(params: any): Promise<ActionResult> {
  const agentId = typeof params?.agentId === 'string' ? params.agentId.trim() : '';
  const tools = params?.tools;
  if (!agentId || !isRecord(tools)) return { ok: false, error: 'Missing agentId or tools' };

  try {
    const config = await readConfigFile();
    const agentList = config.agents?.list || [];
    const idx = agentList.findIndex((a: any) => a.id === agentId);
    if (idx === -1) return { ok: false, error: `Agent ${agentId} not found` };

    const currentAgent = agentList[idx];
    const currentTools = isRecord(currentAgent.tools) ? currentAgent.tools : {};
    const nextTools = { ...currentTools, ...tools };

    if (isRecord(tools.elevated)) {
      nextTools.elevated = {
        ...(isRecord(currentTools.elevated) ? currentTools.elevated : {}),
        ...tools.elevated,
      };
    }

    agentList[idx] = {
      ...currentAgent,
      tools: nextTools,
    };

    await writeConfigFile(config);
    cachedConfig = config;
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    return { ok: true, message: `Agent ${agentId} tools updated.` };
  } catch (err: any) {
    return { ok: false, error: `Failed: ${err.message}` };
  }
}

async function actionConfigUpdate(params: any): Promise<ActionResult> {
  const path = typeof params?.path === 'string' ? params.path.trim() : '';
  const value = params?.value;

  if (!path) return { ok: false, error: 'Missing path' };
  if (!CONFIG_UPDATE_WHITELIST.has(path)) return { ok: false, error: `Config path not allowed: ${path}` };

  try {
    const config = await readConfigFile();
    const parts = path.split('.');
    let target = config;

    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      if (!isRecord(target[key])) target[key] = {};
      target = target[key];
    }

    const leafKey = parts[parts.length - 1];
    target[leafKey] = preserveMaskedSecrets(target[leafKey], value);

    await writeConfigFile(config);
    cachedConfig = config;
    buildingsLastRefresh = 0;
    await refreshBuildings().catch(() => {});
    broadcast({ type: 'event', event: { type: 'info', message: `⚙️ 配置已更新: ${path}`, ts: Date.now() } });
    return { ok: true, message: `配置已更新: ${path}`, data: { needsRestart: true } };
  } catch (err: any) {
    return { ok: false, error: err?.message || `Failed to update config: ${path}` };
  }
}

async function actionGatewayRestart(): Promise<ActionResult> {
  try {
    const { exec } = await import('node:child_process');
    exec('openclaw gateway restart', (err, _stdout, stderr) => {
      if (err) log.error?.(`[clawcraft] Gateway restart error: ${stderr}`);
    });
    broadcast({ type: 'event', event: { type: 'info', message: '🔄 Gateway 重启中...', ts: Date.now() } });
    return { ok: true, message: 'Gateway restart initiated.' };
  } catch (err: any) { return { ok: false, error: `Failed: ${err.message}` }; }
}

async function actionSessionNew(params: any): Promise<ActionResult> {
  const { agentId, message } = params;
  if (!agentId) return { ok: false, error: 'Missing agentId' };
  const sessionId = `clawcraft-${Date.now()}`;
  try {
    const { exec } = await import('node:child_process');
    const msg = message || 'Hello from ClawCraft!';
    exec(`openclaw agent --agent ${agentId} --session-id ${sessionId} --message ${JSON.stringify(msg)} --json`, (err, _stdout, stderr) => {
      if (err) log.error?.(`[clawcraft] Session create error: ${stderr}`);
    });
    return { ok: true, message: `Session ${sessionId} created for ${agentId}.`, data: { sessionId } };
  } catch (err: any) { return { ok: false, error: `Failed: ${err.message}` }; }
}

async function actionSessionCompact(params: any): Promise<ActionResult> {
  const { sessionKey, agentId } = params;
  if (!sessionKey) return { ok: false, error: 'Missing sessionKey' };
  try {
    const { exec } = await import('node:child_process');
    const agent = agentId || sessions.get(sessionKey)?.agentId || 'main';
    exec(`openclaw agent --agent ${agent} --session-id ${sessionKey} --message "/compact" --json`, (err, _stdout, stderr) => {
      if (err) log.error?.(`[clawcraft] Compact error: ${stderr}`);
    });
    broadcast({ type: 'event', event: { type: 'info', message: `🗜️ 对话压缩已触发: ${sessionKey.slice(0, 20)}`, ts: Date.now() } });
    return { ok: true, message: `Compaction triggered for ${sessionKey}.` };
  } catch (err: any) { return { ok: false, error: `Failed: ${err.message}` }; }
}

async function actionSessionReset(params: any): Promise<ActionResult> {
  const { sessionKey, agentId } = params;
  if (!sessionKey) return { ok: false, error: 'Missing sessionKey' };
  try {
    const { exec } = await import('node:child_process');
    const agent = agentId || sessions.get(sessionKey)?.agentId || 'main';
    exec(`openclaw agent --agent ${agent} --session-id ${sessionKey} --message "/reset" --json`, (err, _stdout, stderr) => {
      if (err) log.error?.(`[clawcraft] Reset error: ${stderr}`);
    });
    broadcast({ type: 'event', event: { type: 'info', message: `🗑️ 会话重置已触发: ${sessionKey.slice(0, 20)}`, ts: Date.now() } });
    return { ok: true, message: `Reset triggered for ${sessionKey}.` };
  } catch (err: any) { return { ok: false, error: `Failed: ${err.message}` }; }
}

// ============================================================================
// Plugin Definition
// ============================================================================

// ── Activity & Workspace Files handlers ──

function handleActivity(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') { corsOptions(res); return true; }
  if (req.method !== 'GET') { jsonResponse(res, 405, { ok: false, error: 'Method not allowed' }); return true; }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const agentId = url.searchParams.get('agentId') || undefined;
  const sinceParam = url.searchParams.get('since');
  const limitParam = url.searchParams.get('limit');
  const statsOnly = url.searchParams.get('statsOnly') === 'true';
  const parsedSince = sinceParam ? parseInt(sinceParam, 10) : NaN;
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
  const since = Number.isFinite(parsedSince) ? parsedSince : Date.now() - RECENT_WORKSPACE_WINDOW_MS;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
  const stats = getActivityStats(agentId);

  if (statsOnly) {
    jsonResponse(res, 200, { ok: true, events: [], stats });
    return true;
  }

  const filtered = activityEvents
    .filter((e) => e.timestamp >= since && (!agentId || e.agentId === agentId))
    .slice(0, limit);

  jsonResponse(res, 200, { ok: true, events: filtered, stats });
  return true;
}

function handleWorkspaceFiles(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') { corsOptions(res); return true; }
  if (req.method !== 'GET') { jsonResponse(res, 405, { ok: false, error: 'Method not allowed' }); return true; }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const agentId = url.searchParams.get('agentId') || undefined;
  const limitParam = url.searchParams.get('limit');
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, WORKSPACE_SCAN_MAX_RESULTS) : 100;

  (async () => {
    try {
      const roots = await resolveWorkspaceRoots(agentId);
      const since = Date.now() - RECENT_WORKSPACE_WINDOW_MS;
      const files = (await Promise.all(roots.map((root) => scanWorkspaceRoot(root, since))))
        .flat()
        .sort((left, right) => right.mtime - left.mtime);

      const deduped: WorkspaceFileEntry[] = [];
      const seen = new Set<string>();
      for (const file of files) {
        const key = `${file.agentId}:${file.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(file);
        if (deduped.length >= limit) break;
      }

      jsonResponse(res, 200, { ok: true, files: deduped });
    } catch (err: any) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
  })();

  return true;
}

const clawcraftPlugin = {
  id: "clawcraft",
  name: "ClawCraft",
  description: "RTS-style graphical interface for OpenClaw agent monitoring and operations",

  register(api: any) {
    log = api.logger || console;

    // ── Read Gateway config for internal API calls ──
    readConfigFile().then((config) => {
      gatewayPort = config.gateway?.port || parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789');
      gatewayAuthToken = config.gateway?.auth?.token || process.env.OPENCLAW_GATEWAY_TOKEN || '';

      // ── Populate channel statuses from config ──
      if (config.channels && typeof config.channels === 'object') {
        for (const [channelType, channelConfig] of Object.entries(config.channels) as [string, any][]) {
          channelStatuses.set(channelType, {
            name: channelType,
            type: channelType,
            status: channelConfig.enabled !== false ? 'connected' : 'disconnected',
            lastSeen: Date.now(),
            messageCount: 0,
          });
        }
        log.info?.(`[clawcraft] Loaded ${channelStatuses.size} channel(s) from config`);
      }

      // ── Populate agents from config ──
      const agentList = config.agents?.list || [];
      for (const agentDef of agentList) {
        if (agentDef.id) {
          ensureAgent(agentDef.id, agentDef.model || getAgentDefaultModel(config) || 'unknown');
          const agent = agents.get(agentDef.id);
          const displayName = getAgentDisplayName(agentDef);
          if (agent && displayName) agent.name = displayName;
        }
      }
      if (agentList.length > 0) {
        log.info?.(`[clawcraft] Loaded ${agents.size} agent(s) from config`);
      }

      // Enable chatCompletions if not already
      if (!config.gateway?.http?.endpoints?.chatCompletions?.enabled) {
        config.gateway = config.gateway || {};
        config.gateway.http = config.gateway.http || {};
        config.gateway.http.endpoints = config.gateway.http.endpoints || {};
        config.gateway.http.endpoints.chatCompletions = { enabled: true };
        writeConfigFile(config).then(() => {
          log.info?.("[clawcraft] Enabled chatCompletions endpoint in config");
        }).catch(() => {});
      }
    }).catch((err) => {
      log.error?.(`[clawcraft] Config init error: ${err}`);
    });

    // ── Service ──
    api.registerService({
      id: "clawcraft",
      start: () => {
        startHeartbeat();
        setInterval(evictStaleInternal, 30_000);
        refreshBuildings().catch(() => {});
        log.info?.("[clawcraft] Service started 🏰 v" + VERSION);
      },
      stop: () => {
        stopHeartbeat();
        agents.clear(); sessions.clear(); sseClients.clear();
        log.info?.("[clawcraft] Service stopped");
      },
    });

    // ── Lifecycle Hooks ──
    api.on("before_agent_start", (event: any, context: any) => {
      const sessionKey = context?.sessionId || context?.sessionKey;
      const agentId = context?.agentId || 'main';
      if (sessionKey) ensureSession(sessionKey, agentId);
      hookBeforeAgentStart(event, context);
    });

    api.on("llm_input", (event: any, context: any) => {
      const sessionKey = event?.sessionId || context?.sessionId || context?.sessionKey;
      if (sessionKey) hookLlmInput(event, { ...context, sessionKey });
    });

    api.on("llm_output", (event: any, context: any) => {
      const sessionKey = event?.sessionId || context?.sessionId || context?.sessionKey;
      if (sessionKey) hookLlmOutput(event, { ...context, sessionKey });
    });

    api.on("before_tool_call", (event: any, context: any) => {
      const sessionKey = context?.sessionId || context?.sessionKey;
      if (sessionKey) hookBeforeToolCall(event, { ...context, sessionKey });
    });

    api.on("after_tool_call", (event: any, context: any) => {
      const sessionKey = context?.sessionId || context?.sessionKey;
      if (sessionKey) hookAfterToolCall(event, { ...context, sessionKey });
    });

    api.on("agent_end", (event: any, context: any) => {
      const sessionKey = context?.sessionId || context?.sessionKey;
      if (sessionKey) hookAgentEnd(event, { ...context, sessionKey });
    });

    api.on("subagent_spawned", hookSubagentSpawned);
    api.on("subagent_ended", hookSubagentEnded);

    // ── HTTP Routes ──
    api.registerHttpRoute({ path: "/clawcraft/health",  auth: "plugin", handler: handleHealth,  match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/state",   auth: "plugin", handler: handleState,   match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/events",  auth: "plugin", handler: handleEvents,  match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/chat",    auth: "plugin", handler: handleChat,    match: "prefix" });
    api.registerHttpRoute({ path: "/clawcraft/config",  auth: "plugin", handler: handleConfig,  match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/action",  auth: "plugin", handler: handleAction,  match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/files",   auth: "plugin", handler: handleFiles,   match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/memory",  auth: "plugin", handler: handleMemory,  match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/skills",  auth: "plugin", handler: handleSkills,  match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/activity", auth: "plugin", handler: handleActivity, match: "exact" });
    api.registerHttpRoute({ path: "/clawcraft/workspace-files", auth: "plugin", handler: handleWorkspaceFiles, match: "exact" });

    runtimeApi = api;
    log.info?.(`[clawcraft] Plugin registered — 11 routes, 9 hooks 🏰 v${VERSION}`);
  },
};

export default clawcraftPlugin;

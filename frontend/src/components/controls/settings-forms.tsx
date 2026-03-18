import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Input } from '@/components/ui/input';
import { useWorldStore } from '@/store/world-store';

export interface SettingsFormProps {
  config: any;
  onConfigRefresh: () => void | Promise<void>;
}

interface HeartbeatFormState {
  every: string;
  model: string;
  lightContext: boolean;
  session: string;
  target: string;
  prompt: string;
  ackMaxChars: string;
  suppressToolErrorWarnings: boolean;
  directPolicy: string;
}

interface CompactionFormState {
  mode: string;
  reserveTokensFloor: string;
  identifierPolicy: string;
  identifierInstructions: string;
  postCompactionSections: string;
  model: string;
  memoryFlushEnabled: boolean;
  memoryFlushSoftThresholdTokens: string;
  memoryFlushSystemPrompt: string;
  memoryFlushPrompt: string;
}

interface SessionFormState {
  scope: string;
  dmScope: string;
  resetMode: string;
  resetAtHour: string;
  resetIdleMinutes: string;
  resetTriggers: string;
  maintenanceMode: string;
  maintenancePruneAfter: string;
  maintenanceMaxEntries: string;
}

interface MessagesFormState {
  responsePrefix: string;
  ackReaction: string;
  ackReactionScope: string;
  removeAckAfterReply: boolean;
  queueMode: string;
  queueDebounceMs: string;
  queueCap: string;
  inboundDebounceMs: string;
}

interface ElevatedToolsFormState {
  enabled: boolean;
  allowFromJson: string;
}

interface CommandsFormState {
  json: string;
}

interface SandboxFormState {
  mode: string;
  scope: string;
  workspaceAccess: string;
  workspaceRoot: string;
  dockerImage: string;
  dockerNetwork: string;
  dockerMemory: string;
  dockerCpus: string;
  dockerSetupCommand: string;
  browserEnabled: boolean;
}

interface BrowserFormState {
  enabled: boolean;
  profile: string;
  cdpPort: string;
  headless: boolean;
  blockPrivateRanges: boolean;
}

interface JsonFormState {
  json: string;
}

interface TtsFormState {
  auto: string;
  mode: string;
  provider: string;
  maxTextLength: string;
  timeoutMs: string;
}

interface WebToolsFormState {
  searchEnabled: boolean;
  searchMaxResults: string;
  searchTimeoutSeconds: string;
  fetchEnabled: boolean;
  fetchMaxChars: string;
  fetchTimeoutSeconds: string;
}

interface ExecToolsFormState {
  backgroundMs: string;
  timeoutSec: string;
  cleanupMs: string;
  notifyOnExit: boolean;
  applyPatchEnabled: boolean;
}

interface LoopDetectionFormState {
  enabled: boolean;
  historySize: string;
  warningThreshold: string;
  criticalThreshold: string;
  globalCircuitBreakerThreshold: string;
}

interface LoggingFormState {
  level: string;
  file: string;
  redact: boolean;
}

interface DiscoveryFormState {
  enabled: boolean;
  mdns: boolean;
}

interface CanvasFormState {
  root: string;
  liveReload: boolean;
}

interface GatewayFormState {
  port: string;
  authEnabled: boolean;
  authToken: string;
  controlUi: boolean;
}

interface SaveState {
  ok: boolean;
  message: string;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord(value: unknown): Record<string, any> {
  return isRecord(value) ? { ...value } : {};
}

function listToText(value: unknown): string {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').join(', ') : '';
}

function textToList(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function assignOptionalText(target: Record<string, any>, key: string, value: string) {
  const next = value.trim();
  if (next) target[key] = next;
  else delete target[key];
}

function assignOptionalNumber(target: Record<string, any>, key: string, value: string, label: string) {
  const next = value.trim();
  if (!next) {
    delete target[key];
    return;
  }

  const parsed = Number(next);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 必须是数字`);
  target[key] = parsed;
}

function assignOptionalList(target: Record<string, any>, key: string, value: string) {
  const next = textToList(value);
  if (next.length > 0) target[key] = next;
  else delete target[key];
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(isRecord(value) ? value : {}, null, 2);
}

function parseJsonObject(text: string, label: string): Record<string, any> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!isRecord(parsed)) throw new Error(`${label} 必须是 JSON 对象`);
  return parsed;
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

  for (const agent of Array.isArray(config?.agents?.list) ? config.agents.list : []) {
    if (typeof agent?.model === 'string' && agent.model) values.add(agent.model);
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

function readHeartbeatForm(config: any): HeartbeatFormState {
  const heartbeat = config?.agents?.defaults?.heartbeat || {};
  return {
    every: typeof heartbeat.every === 'string' ? heartbeat.every : '',
    model: typeof heartbeat.model === 'string' ? heartbeat.model : '',
    lightContext: Boolean(heartbeat.lightContext),
    session: typeof heartbeat.session === 'string' ? heartbeat.session : '',
    target: typeof heartbeat.target === 'string' ? heartbeat.target : '',
    prompt: typeof heartbeat.prompt === 'string' ? heartbeat.prompt : '',
    ackMaxChars: typeof heartbeat.ackMaxChars === 'number' ? String(heartbeat.ackMaxChars) : '',
    suppressToolErrorWarnings: Boolean(heartbeat.suppressToolErrorWarnings),
    directPolicy: typeof heartbeat.directPolicy === 'string' ? heartbeat.directPolicy : 'allow',
  };
}

function readCompactionForm(config: any): CompactionFormState {
  const compaction = config?.agents?.defaults?.compaction || {};
  const memoryFlush = isRecord(compaction.memoryFlush) ? compaction.memoryFlush : {};
  return {
    mode: typeof compaction.mode === 'string' ? compaction.mode : 'default',
    reserveTokensFloor: typeof compaction.reserveTokensFloor === 'number' ? String(compaction.reserveTokensFloor) : '',
    identifierPolicy: typeof compaction.identifierPolicy === 'string' ? compaction.identifierPolicy : 'strict',
    identifierInstructions: typeof compaction.identifierInstructions === 'string' ? compaction.identifierInstructions : '',
    postCompactionSections: listToText(compaction.postCompactionSections),
    model: typeof compaction.model === 'string' ? compaction.model : '',
    memoryFlushEnabled: Boolean(memoryFlush.enabled),
    memoryFlushSoftThresholdTokens: typeof memoryFlush.softThresholdTokens === 'number' ? String(memoryFlush.softThresholdTokens) : '',
    memoryFlushSystemPrompt: typeof memoryFlush.systemPrompt === 'string' ? memoryFlush.systemPrompt : '',
    memoryFlushPrompt: typeof memoryFlush.prompt === 'string' ? memoryFlush.prompt : '',
  };
}

function readSessionForm(config: any): SessionFormState {
  const session = config?.session || {};
  const reset = isRecord(session.reset) ? session.reset : {};
  const maintenance = isRecord(session.maintenance) ? session.maintenance : {};
  return {
    scope: typeof session.scope === 'string' ? session.scope : '',
    dmScope: typeof session.dmScope === 'string' ? session.dmScope : 'main',
    resetMode: typeof reset.mode === 'string' ? reset.mode : 'daily',
    resetAtHour: typeof reset.atHour === 'number' ? String(reset.atHour) : '',
    resetIdleMinutes: typeof reset.idleMinutes === 'number' ? String(reset.idleMinutes) : '',
    resetTriggers: listToText(session.resetTriggers),
    maintenanceMode: typeof maintenance.mode === 'string' ? maintenance.mode : 'warn',
    maintenancePruneAfter: typeof maintenance.pruneAfter === 'string' ? maintenance.pruneAfter : '',
    maintenanceMaxEntries: typeof maintenance.maxEntries === 'number' ? String(maintenance.maxEntries) : '',
  };
}

function readMessagesForm(config: any): MessagesFormState {
  const messages = config?.messages || {};
  const queue = isRecord(messages.queue) ? messages.queue : {};
  const inbound = isRecord(messages.inbound) ? messages.inbound : {};
  return {
    responsePrefix: typeof messages.responsePrefix === 'string' ? messages.responsePrefix : '',
    ackReaction: typeof messages.ackReaction === 'string' ? messages.ackReaction : '',
    ackReactionScope: typeof messages.ackReactionScope === 'string' ? messages.ackReactionScope : 'group-mentions',
    removeAckAfterReply: Boolean(messages.removeAckAfterReply),
    queueMode: typeof queue.mode === 'string' ? queue.mode : 'collect',
    queueDebounceMs: typeof queue.debounceMs === 'number' ? String(queue.debounceMs) : '',
    queueCap: typeof queue.cap === 'number' ? String(queue.cap) : '',
    inboundDebounceMs: typeof inbound.debounceMs === 'number' ? String(inbound.debounceMs) : '',
  };
}

function readElevatedToolsForm(config: any): ElevatedToolsFormState {
  const elevated = config?.tools?.elevated || {};
  return {
    enabled: Boolean(elevated.enabled),
    allowFromJson: JSON.stringify(isRecord(elevated.allowFrom) ? elevated.allowFrom : {}, null, 2),
  };
}

function readCommandsForm(config: any): CommandsFormState {
  return { json: stringifyJson(config?.commands) };
}

function readSandboxForm(config: any): SandboxFormState {
  const sandbox = config?.agents?.defaults?.sandbox || {};
  const docker = isRecord(sandbox.docker) ? sandbox.docker : {};
  const browser = isRecord(sandbox.browser) ? sandbox.browser : {};
  return {
    mode: typeof sandbox.mode === 'string' ? sandbox.mode : 'off',
    scope: typeof sandbox.scope === 'string' ? sandbox.scope : 'agent',
    workspaceAccess: typeof sandbox.workspaceAccess === 'string' ? sandbox.workspaceAccess : 'none',
    workspaceRoot: typeof sandbox.workspaceRoot === 'string' ? sandbox.workspaceRoot : '',
    dockerImage: typeof docker.image === 'string' ? docker.image : '',
    dockerNetwork: typeof docker.network === 'string' ? docker.network : 'none',
    dockerMemory: typeof docker.memory === 'string' ? docker.memory : '',
    dockerCpus: typeof docker.cpus === 'number' ? String(docker.cpus) : '',
    dockerSetupCommand: typeof docker.setupCommand === 'string' ? docker.setupCommand : '',
    browserEnabled: Boolean(browser.enabled),
  };
}

function readBrowserForm(config: any): BrowserFormState {
  const browser = config?.browser || {};
  const profiles = isRecord(browser.profiles) ? browser.profiles : {};
  const profile = typeof browser.defaultProfile === 'string'
    ? browser.defaultProfile
    : typeof browser.profile === 'string'
      ? browser.profile
      : typeof Object.keys(profiles)[0] === 'string'
        ? Object.keys(profiles)[0]
        : '';
  const profileConfig = profile && isRecord(profiles[profile]) ? profiles[profile] : {};
  const ssrfPolicy = isRecord(browser.ssrfPolicy) ? browser.ssrfPolicy : {};
  const blockPrivateRanges = typeof ssrfPolicy.dangerouslyAllowPrivateNetwork === 'boolean'
    ? !ssrfPolicy.dangerouslyAllowPrivateNetwork
    : false;

  return {
    enabled: Boolean(browser.enabled),
    profile,
    cdpPort: typeof profileConfig.cdpPort === 'number'
      ? String(profileConfig.cdpPort)
      : typeof browser.cdpPort === 'number'
        ? String(browser.cdpPort)
        : '',
    headless: Boolean(browser.headless),
    blockPrivateRanges,
  };
}

function readJsonForm(value: unknown): JsonFormState {
  return { json: stringifyJson(value) };
}

function readTtsForm(config: any): TtsFormState {
  const tts = config?.messages?.tts || {};
  return {
    auto: typeof tts.auto === 'string' ? tts.auto : 'off',
    mode: typeof tts.mode === 'string' ? tts.mode : 'final',
    provider: typeof tts.provider === 'string' ? tts.provider : 'elevenlabs',
    maxTextLength: typeof tts.maxTextLength === 'number' ? String(tts.maxTextLength) : '',
    timeoutMs: typeof tts.timeoutMs === 'number' ? String(tts.timeoutMs) : '',
  };
}

function readWebToolsForm(config: any): WebToolsFormState {
  const web = config?.tools?.web || {};
  const search = isRecord(web.search) ? web.search : {};
  const fetch = isRecord(web.fetch) ? web.fetch : {};
  return {
    searchEnabled: Boolean(search.enabled),
    searchMaxResults: typeof search.maxResults === 'number' ? String(search.maxResults) : '',
    searchTimeoutSeconds: typeof search.timeoutSeconds === 'number' ? String(search.timeoutSeconds) : '',
    fetchEnabled: Boolean(fetch.enabled),
    fetchMaxChars: typeof fetch.maxChars === 'number' ? String(fetch.maxChars) : '',
    fetchTimeoutSeconds: typeof fetch.timeoutSeconds === 'number' ? String(fetch.timeoutSeconds) : '',
  };
}

function readExecToolsForm(config: any): ExecToolsFormState {
  const exec = config?.tools?.exec || {};
  const applyPatch = isRecord(exec.applyPatch) ? exec.applyPatch : {};
  return {
    backgroundMs: typeof exec.backgroundMs === 'number' ? String(exec.backgroundMs) : '',
    timeoutSec: typeof exec.timeoutSec === 'number' ? String(exec.timeoutSec) : '',
    cleanupMs: typeof exec.cleanupMs === 'number' ? String(exec.cleanupMs) : '',
    notifyOnExit: Boolean(exec.notifyOnExit),
    applyPatchEnabled: Boolean(applyPatch.enabled),
  };
}

function readLoopDetectionForm(config: any): LoopDetectionFormState {
  const loopDetection = config?.tools?.loopDetection || {};
  return {
    enabled: Boolean(loopDetection.enabled),
    historySize: typeof loopDetection.historySize === 'number' ? String(loopDetection.historySize) : '',
    warningThreshold: typeof loopDetection.warningThreshold === 'number' ? String(loopDetection.warningThreshold) : '',
    criticalThreshold: typeof loopDetection.criticalThreshold === 'number' ? String(loopDetection.criticalThreshold) : '',
    globalCircuitBreakerThreshold: typeof loopDetection.globalCircuitBreakerThreshold === 'number'
      ? String(loopDetection.globalCircuitBreakerThreshold)
      : '',
  };
}

function readLoggingForm(config: any): LoggingFormState {
  const logging = config?.logging || {};
  return {
    level: typeof logging.level === 'string' ? logging.level : 'info',
    file: typeof logging.file === 'string' ? logging.file : '',
    redact: logging.redactSensitive === 'off' ? false : Boolean(logging.redactSensitive),
  };
}

function readDiscoveryForm(config: any): DiscoveryFormState {
  const discovery = config?.discovery || {};
  const wideArea = isRecord(discovery.wideArea) ? discovery.wideArea : {};
  const mdns = isRecord(discovery.mdns) ? discovery.mdns : {};
  return {
    enabled: Boolean(wideArea.enabled),
    mdns: typeof mdns.mode === 'string' ? mdns.mode !== 'off' : false,
  };
}

function readCanvasForm(config: any): CanvasFormState {
  const canvasHost = config?.canvasHost || {};
  return {
    root: typeof canvasHost.root === 'string' ? canvasHost.root : '',
    liveReload: Boolean(canvasHost.liveReload),
  };
}

function readGatewayForm(config: any): GatewayFormState {
  const gateway = config?.gateway || {};
  const auth = isRecord(gateway.auth) ? gateway.auth : {};
  const controlUi = isRecord(gateway.controlUi) ? gateway.controlUi : {};
  const authMode = typeof auth.mode === 'string' ? auth.mode : '';

  return {
    port: typeof gateway.port === 'number' ? String(gateway.port) : '',
    authEnabled: authMode !== 'none',
    authToken: typeof auth.token === 'string' ? auth.token : '',
    controlUi: Boolean(controlUi.enabled),
  };
}

function useConfigSection(onConfigRefresh: () => void | Promise<void>) {
  const addEvent = useWorldStore((s) => s.addEvent);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveState | null>(null);

  const executeConfigUpdate = useCallback(async (path: string, value: unknown, successMessage: string) => {
    setSaving(true);
    setResult(null);

    try {
      const response = await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'config.update',
          params: { path, value },
        }),
      });
      const data = await response.json();

      if (!data.ok) {
        setResult({ ok: false, message: data.error || '保存失败' });
        return data;
      }

      const restartSuffix = data.data?.needsRestart ? '，需重启 Gateway 生效' : '';
      setResult({ ok: true, message: `${successMessage}${restartSuffix}` });
      addEvent({
        id: `config-${path}-${Date.now()}`,
        type: 'info',
        message: `${successMessage}${restartSuffix}`,
        ts: Date.now(),
      });
      await onConfigRefresh();
      return data;
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '保存失败' });
      return { ok: false, error: err.message || '保存失败' };
    } finally {
      setSaving(false);
    }
  }, [addEvent, onConfigRefresh]);

  return { saving, result, setResult, executeConfigUpdate };
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-100">{title}</p>
      <p className="text-[11px] text-slate-500">{subtitle}</p>
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

function Textarea({
  mono = false,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return (
    <textarea
      className={`min-h-[120px] w-full rounded-2xl border border-slate-700/80 bg-slate-950/65 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/50 ${mono ? 'font-mono text-[12px]' : ''} ${className}`}
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

function SaveRow({
  saving,
  onSave,
  label,
}: {
  saving: boolean;
  onSave: () => void;
  label: string;
}) {
  return (
    <div className="flex justify-start">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
      >
        {saving ? '⏳ 保存中...' : label}
      </button>
    </div>
  );
}

function SaveResultBanner({ result }: { result: SaveState | null }) {
  if (!result) return null;
  return (
    <div className={`rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
      {result.ok ? '✅' : '❌'} {result.message}
    </div>
  );
}

function JsonEditorForm({
  title,
  subtitle,
  label,
  placeholder,
  json,
  onChange,
  saving,
  onSave,
  result,
  saveLabel,
}: {
  title: string;
  subtitle: string;
  label: string;
  placeholder?: string;
  json: string;
  onChange: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  result: SaveState | null;
  saveLabel: string;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle title={title} subtitle={subtitle} />
      <Field label={label}>
        <Textarea value={json} onChange={(event) => onChange(event.target.value)} rows={14} mono placeholder={placeholder} />
      </Field>
      <SaveRow saving={saving} onSave={onSave} label={saveLabel} />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function HeartbeatForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<HeartbeatFormState>(readHeartbeatForm(config));
  const modelOptions = useMemo(() => collectModelOptions(config), [config]);
  const modelListId = useId();
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readHeartbeatForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.agents?.defaults?.heartbeat);
      assignOptionalText(next, 'every', form.every);
      assignOptionalText(next, 'model', form.model);
      next.lightContext = form.lightContext;
      assignOptionalText(next, 'session', form.session);
      assignOptionalText(next, 'target', form.target);
      assignOptionalText(next, 'prompt', form.prompt);
      assignOptionalNumber(next, 'ackMaxChars', form.ackMaxChars, 'ackMaxChars');
      next.suppressToolErrorWarnings = form.suppressToolErrorWarnings;
      assignOptionalText(next, 'directPolicy', form.directPolicy);
      await executeConfigUpdate('agents.defaults.heartbeat', next, '💓 心跳配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '心跳配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      {modelOptions.length > 0 && (
        <datalist id={modelListId}>
          {modelOptions.map((option) => <option key={option} value={option} />)}
        </datalist>
      )}
      <SectionTitle title="Heartbeat" subtitle="写入 `agents.defaults.heartbeat`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="every">
          <Input value={form.every} onChange={(event) => setForm((prev) => ({ ...prev, every: event.target.value }))} placeholder="30m" />
        </Field>
        <Field label="model">
          <Input list={modelOptions.length > 0 ? modelListId : undefined} value={form.model} onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))} placeholder="provider/model" />
        </Field>
        <Field label="session">
          <Input value={form.session} onChange={(event) => setForm((prev) => ({ ...prev, session: event.target.value }))} placeholder="main" />
        </Field>
        <Field label="target">
          <Input value={form.target} onChange={(event) => setForm((prev) => ({ ...prev, target: event.target.value }))} placeholder="none / telegram" />
        </Field>
        <Field label="ackMaxChars">
          <Input type="number" value={form.ackMaxChars} onChange={(event) => setForm((prev) => ({ ...prev, ackMaxChars: event.target.value }))} placeholder="120" />
        </Field>
        <Field label="directPolicy">
          <Select value={form.directPolicy} onChange={(event) => setForm((prev) => ({ ...prev, directPolicy: event.target.value }))}>
            <option value="allow">allow</option>
            <option value="block">block</option>
          </Select>
        </Field>
        <Field className="sm:col-span-2" label="prompt">
          <Textarea value={form.prompt} onChange={(event) => setForm((prev) => ({ ...prev, prompt: event.target.value }))} rows={5} placeholder="Heartbeat prompt..." />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleField label="lightContext" checked={form.lightContext} onChange={(checked) => setForm((prev) => ({ ...prev, lightContext: checked }))} />
        <ToggleField
          label="suppressToolErrorWarnings"
          checked={form.suppressToolErrorWarnings}
          onChange={(checked) => setForm((prev) => ({ ...prev, suppressToolErrorWarnings: checked }))}
        />
      </div>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存心跳配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function CompactionForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<CompactionFormState>(readCompactionForm(config));
  const modelOptions = useMemo(() => collectModelOptions(config), [config]);
  const modelListId = useId();
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readCompactionForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.agents?.defaults?.compaction);
      assignOptionalText(next, 'mode', form.mode);
      assignOptionalNumber(next, 'reserveTokensFloor', form.reserveTokensFloor, 'reserveTokensFloor');
      assignOptionalText(next, 'identifierPolicy', form.identifierPolicy);
      if (form.identifierPolicy === 'custom') {
        assignOptionalText(next, 'identifierInstructions', form.identifierInstructions);
      } else {
        delete next.identifierInstructions;
      }
      assignOptionalList(next, 'postCompactionSections', form.postCompactionSections);
      assignOptionalText(next, 'model', form.model);

      const memoryFlush = cloneRecord(next.memoryFlush);
      memoryFlush.enabled = form.memoryFlushEnabled;
      assignOptionalNumber(memoryFlush, 'softThresholdTokens', form.memoryFlushSoftThresholdTokens, 'memoryFlush.softThresholdTokens');
      assignOptionalText(memoryFlush, 'systemPrompt', form.memoryFlushSystemPrompt);
      assignOptionalText(memoryFlush, 'prompt', form.memoryFlushPrompt);
      next.memoryFlush = memoryFlush;

      await executeConfigUpdate('agents.defaults.compaction', next, '🗜️ 压缩配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '压缩配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      {modelOptions.length > 0 && (
        <datalist id={modelListId}>
          {modelOptions.map((option) => <option key={option} value={option} />)}
        </datalist>
      )}
      <SectionTitle title="Compaction" subtitle="写入 `agents.defaults.compaction`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="mode">
          <Select value={form.mode} onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value }))}>
            <option value="default">default</option>
            <option value="safeguard">safeguard</option>
          </Select>
        </Field>
        <Field label="reserveTokensFloor">
          <Input type="number" value={form.reserveTokensFloor} onChange={(event) => setForm((prev) => ({ ...prev, reserveTokensFloor: event.target.value }))} placeholder="12000" />
        </Field>
        <Field label="identifierPolicy">
          <Select value={form.identifierPolicy} onChange={(event) => setForm((prev) => ({ ...prev, identifierPolicy: event.target.value }))}>
            <option value="strict">strict</option>
            <option value="off">off</option>
            <option value="custom">custom</option>
          </Select>
        </Field>
        <Field label="model">
          <Input list={modelOptions.length > 0 ? modelListId : undefined} value={form.model} onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))} placeholder="provider/model" />
        </Field>
        {form.identifierPolicy === 'custom' && (
          <Field className="sm:col-span-2" label="identifierInstructions">
            <Input value={form.identifierInstructions} onChange={(event) => setForm((prev) => ({ ...prev, identifierInstructions: event.target.value }))} placeholder="Custom identifier instructions" />
          </Field>
        )}
        <Field className="sm:col-span-2" label="postCompactionSections">
          <Input value={form.postCompactionSections} onChange={(event) => setForm((prev) => ({ ...prev, postCompactionSections: event.target.value }))} placeholder="summary, reminders, blockers" />
        </Field>
      </div>
      <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">Memory Flush</p>
        <div className="mt-3 space-y-3">
          <ToggleField label="memoryFlush.enabled" checked={form.memoryFlushEnabled} onChange={(checked) => setForm((prev) => ({ ...prev, memoryFlushEnabled: checked }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="memoryFlush.softThresholdTokens">
              <Input type="number" value={form.memoryFlushSoftThresholdTokens} onChange={(event) => setForm((prev) => ({ ...prev, memoryFlushSoftThresholdTokens: event.target.value }))} placeholder="80000" />
            </Field>
            <div />
            <Field className="sm:col-span-2" label="memoryFlush.systemPrompt">
              <Textarea value={form.memoryFlushSystemPrompt} onChange={(event) => setForm((prev) => ({ ...prev, memoryFlushSystemPrompt: event.target.value }))} rows={4} placeholder="System prompt..." />
            </Field>
            <Field className="sm:col-span-2" label="memoryFlush.prompt">
              <Textarea value={form.memoryFlushPrompt} onChange={(event) => setForm((prev) => ({ ...prev, memoryFlushPrompt: event.target.value }))} rows={4} placeholder="Prompt..." />
            </Field>
          </div>
        </div>
      </div>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存压缩配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function SessionForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<SessionFormState>(readSessionForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readSessionForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.session);
      assignOptionalText(next, 'scope', form.scope);
      assignOptionalText(next, 'dmScope', form.dmScope);

      const reset = cloneRecord(next.reset);
      assignOptionalText(reset, 'mode', form.resetMode);
      if (form.resetMode === 'daily') {
        assignOptionalNumber(reset, 'atHour', form.resetAtHour, 'reset.atHour');
        delete reset.idleMinutes;
      } else {
        assignOptionalNumber(reset, 'idleMinutes', form.resetIdleMinutes, 'reset.idleMinutes');
        delete reset.atHour;
      }
      next.reset = reset;

      assignOptionalList(next, 'resetTriggers', form.resetTriggers);

      const maintenance = cloneRecord(next.maintenance);
      assignOptionalText(maintenance, 'mode', form.maintenanceMode);
      assignOptionalText(maintenance, 'pruneAfter', form.maintenancePruneAfter);
      assignOptionalNumber(maintenance, 'maxEntries', form.maintenanceMaxEntries, 'maintenance.maxEntries');
      next.maintenance = maintenance;

      await executeConfigUpdate('session', next, '🧭 会话配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '会话配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Session" subtitle="写入 `session`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="scope">
          <Input value={form.scope} onChange={(event) => setForm((prev) => ({ ...prev, scope: event.target.value }))} placeholder="global" />
        </Field>
        <Field label="dmScope">
          <Select value={form.dmScope} onChange={(event) => setForm((prev) => ({ ...prev, dmScope: event.target.value }))}>
            <option value="main">main</option>
            <option value="per-peer">per-peer</option>
            <option value="per-channel-peer">per-channel-peer</option>
            <option value="per-account-channel-peer">per-account-channel-peer</option>
          </Select>
        </Field>
        <Field label="reset.mode">
          <Select value={form.resetMode} onChange={(event) => setForm((prev) => ({ ...prev, resetMode: event.target.value }))}>
            <option value="daily">daily</option>
            <option value="idle">idle</option>
          </Select>
        </Field>
        {form.resetMode === 'daily' ? (
          <Field label="reset.atHour">
            <Input type="number" min={0} max={23} value={form.resetAtHour} onChange={(event) => setForm((prev) => ({ ...prev, resetAtHour: event.target.value }))} placeholder="8" />
          </Field>
        ) : (
          <Field label="reset.idleMinutes">
            <Input type="number" value={form.resetIdleMinutes} onChange={(event) => setForm((prev) => ({ ...prev, resetIdleMinutes: event.target.value }))} placeholder="120" />
          </Field>
        )}
        <Field className="sm:col-span-2" label="resetTriggers">
          <Input value={form.resetTriggers} onChange={(event) => setForm((prev) => ({ ...prev, resetTriggers: event.target.value }))} placeholder="GatewayRestart, NewDay" />
        </Field>
        <Field label="maintenance.mode">
          <Select value={form.maintenanceMode} onChange={(event) => setForm((prev) => ({ ...prev, maintenanceMode: event.target.value }))}>
            <option value="warn">warn</option>
            <option value="enforce">enforce</option>
          </Select>
        </Field>
        <Field label="maintenance.pruneAfter">
          <Input value={form.maintenancePruneAfter} onChange={(event) => setForm((prev) => ({ ...prev, maintenancePruneAfter: event.target.value }))} placeholder="7d" />
        </Field>
        <Field label="maintenance.maxEntries">
          <Input type="number" value={form.maintenanceMaxEntries} onChange={(event) => setForm((prev) => ({ ...prev, maintenanceMaxEntries: event.target.value }))} placeholder="500" />
        </Field>
      </div>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存会话配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function MessagesForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<MessagesFormState>(readMessagesForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readMessagesForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.messages);
      assignOptionalText(next, 'responsePrefix', form.responsePrefix);
      assignOptionalText(next, 'ackReaction', form.ackReaction);
      assignOptionalText(next, 'ackReactionScope', form.ackReactionScope);
      next.removeAckAfterReply = form.removeAckAfterReply;

      const queue = cloneRecord(next.queue);
      assignOptionalText(queue, 'mode', form.queueMode);
      assignOptionalNumber(queue, 'debounceMs', form.queueDebounceMs, 'queue.debounceMs');
      assignOptionalNumber(queue, 'cap', form.queueCap, 'queue.cap');
      next.queue = queue;

      const inbound = cloneRecord(next.inbound);
      assignOptionalNumber(inbound, 'debounceMs', form.inboundDebounceMs, 'inbound.debounceMs');
      next.inbound = inbound;

      await executeConfigUpdate('messages', next, '💬 消息配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '消息配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Messages" subtitle="写入 `messages`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="responsePrefix">
          <Input value={form.responsePrefix} onChange={(event) => setForm((prev) => ({ ...prev, responsePrefix: event.target.value }))} placeholder="[Ottor]" />
        </Field>
        <Field label="ackReaction">
          <Input value={form.ackReaction} onChange={(event) => setForm((prev) => ({ ...prev, ackReaction: event.target.value }))} placeholder="👀" />
        </Field>
        <Field label="ackReactionScope">
          <Select value={form.ackReactionScope} onChange={(event) => setForm((prev) => ({ ...prev, ackReactionScope: event.target.value }))}>
            <option value="group-mentions">group-mentions</option>
            <option value="group-all">group-all</option>
            <option value="direct">direct</option>
            <option value="all">all</option>
          </Select>
        </Field>
        <Field label="queue.mode">
          <Select value={form.queueMode} onChange={(event) => setForm((prev) => ({ ...prev, queueMode: event.target.value }))}>
            <option value="collect">collect</option>
            <option value="steer">steer</option>
            <option value="followup">followup</option>
            <option value="queue">queue</option>
            <option value="interrupt">interrupt</option>
          </Select>
        </Field>
        <Field label="queue.debounceMs">
          <Input type="number" value={form.queueDebounceMs} onChange={(event) => setForm((prev) => ({ ...prev, queueDebounceMs: event.target.value }))} placeholder="500" />
        </Field>
        <Field label="queue.cap">
          <Input type="number" value={form.queueCap} onChange={(event) => setForm((prev) => ({ ...prev, queueCap: event.target.value }))} placeholder="10" />
        </Field>
        <Field label="inbound.debounceMs">
          <Input type="number" value={form.inboundDebounceMs} onChange={(event) => setForm((prev) => ({ ...prev, inboundDebounceMs: event.target.value }))} placeholder="0" />
        </Field>
      </div>
      <ToggleField label="removeAckAfterReply" checked={form.removeAckAfterReply} onChange={(checked) => setForm((prev) => ({ ...prev, removeAckAfterReply: checked }))} />
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存消息配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function TtsForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<TtsFormState>(readTtsForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readTtsForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.messages?.tts);
      assignOptionalText(next, 'auto', form.auto);
      assignOptionalText(next, 'mode', form.mode);
      assignOptionalText(next, 'provider', form.provider);
      assignOptionalNumber(next, 'maxTextLength', form.maxTextLength, 'messages.tts.maxTextLength');
      assignOptionalNumber(next, 'timeoutMs', form.timeoutMs, 'messages.tts.timeoutMs');
      await executeConfigUpdate('messages.tts', next, '🔊 TTS 配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || 'TTS 配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="TTS" subtitle="写入 `messages.tts`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="auto">
          <Select value={form.auto} onChange={(event) => setForm((prev) => ({ ...prev, auto: event.target.value }))}>
            <option value="off">off</option>
            <option value="always">always</option>
            <option value="inbound">inbound</option>
            <option value="tagged">tagged</option>
          </Select>
        </Field>
        <Field label="mode">
          <Select value={form.mode} onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value }))}>
            <option value="final">final</option>
            <option value="all">all</option>
          </Select>
        </Field>
        <Field label="provider">
          <Select value={form.provider} onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}>
            <option value="elevenlabs">elevenlabs</option>
            <option value="openai">openai</option>
          </Select>
        </Field>
        <Field label="maxTextLength">
          <Input type="number" value={form.maxTextLength} onChange={(event) => setForm((prev) => ({ ...prev, maxTextLength: event.target.value }))} placeholder="4000" />
        </Field>
        <Field label="timeoutMs">
          <Input type="number" value={form.timeoutMs} onChange={(event) => setForm((prev) => ({ ...prev, timeoutMs: event.target.value }))} placeholder="30000" />
        </Field>
      </div>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存 TTS 配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function HooksForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<JsonFormState>(readJsonForm(config?.hooks));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readJsonForm(config?.hooks));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const parsed = parseJsonObject(form.json, 'hooks');
      await executeConfigUpdate('hooks', parsed, '🪝 Webhook 配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || 'Webhook 配置保存失败' });
    }
  }, [executeConfigUpdate, form.json, setResult]);

  return (
    <JsonEditorForm
      title="Hooks"
      subtitle="写入整个 `hooks` 对象"
      label="hooks JSON"
      json={form.json}
      onChange={(value) => setForm({ json: value })}
      saving={saving}
      onSave={() => { void handleSave(); }}
      result={result}
      saveLabel="💾 保存 Webhook 配置"
    />
  );
}

export function ElevatedForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<ElevatedToolsFormState>(readElevatedToolsForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readElevatedToolsForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.tools?.elevated);
      next.enabled = form.enabled;

      const allowFromText = form.allowFromJson.trim();
      if (allowFromText) {
        next.allowFrom = parseJsonObject(allowFromText, 'allowFrom');
      } else {
        delete next.allowFrom;
      }

      await executeConfigUpdate('tools.elevated', next, '🛡️ 工具提权配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '工具提权配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Elevated Tools" subtitle="写入 `tools.elevated`" />
      <ToggleField label="enabled" checked={form.enabled} onChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))} />
      <Field label="allowFrom JSON">
        <Textarea
          value={form.allowFromJson}
          onChange={(event) => setForm((prev) => ({ ...prev, allowFromJson: event.target.value }))}
          rows={10}
          mono
          placeholder={`{\n  "mattermost": ["research"],\n  "telegram": ["123456"]\n}`}
        />
      </Field>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存提权配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function CommandsForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<CommandsFormState>(readCommandsForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readCommandsForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const parsed = parseJsonObject(form.json, 'commands');
      await executeConfigUpdate('commands', parsed, '⌨️ 命令配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '命令配置保存失败' });
    }
  }, [executeConfigUpdate, form.json, setResult]);

  return (
    <JsonEditorForm
      title="Commands"
      subtitle="写入 `commands`"
      label="commands JSON"
      placeholder={`{\n  "native": "auto"\n}`}
      json={form.json}
      onChange={(value) => setForm({ json: value })}
      saving={saving}
      onSave={() => { void handleSave(); }}
      result={result}
      saveLabel="💾 保存命令配置"
    />
  );
}

export function ExecForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<ExecToolsFormState>(readExecToolsForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readExecToolsForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.tools?.exec);
      assignOptionalNumber(next, 'backgroundMs', form.backgroundMs, 'tools.exec.backgroundMs');
      assignOptionalNumber(next, 'timeoutSec', form.timeoutSec, 'tools.exec.timeoutSec');
      assignOptionalNumber(next, 'cleanupMs', form.cleanupMs, 'tools.exec.cleanupMs');
      next.notifyOnExit = form.notifyOnExit;

      const applyPatch = cloneRecord(next.applyPatch);
      applyPatch.enabled = form.applyPatchEnabled;
      next.applyPatch = applyPatch;

      await executeConfigUpdate('tools.exec', next, '🛠️ Exec 工具配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || 'Exec 工具配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Exec Tools" subtitle="写入 `tools.exec`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="backgroundMs">
          <Input type="number" value={form.backgroundMs} onChange={(event) => setForm((prev) => ({ ...prev, backgroundMs: event.target.value }))} placeholder="10000" />
        </Field>
        <Field label="timeoutSec">
          <Input type="number" value={form.timeoutSec} onChange={(event) => setForm((prev) => ({ ...prev, timeoutSec: event.target.value }))} placeholder="1800" />
        </Field>
        <Field label="cleanupMs">
          <Input type="number" value={form.cleanupMs} onChange={(event) => setForm((prev) => ({ ...prev, cleanupMs: event.target.value }))} placeholder="1800000" />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleField label="notifyOnExit" checked={form.notifyOnExit} onChange={(checked) => setForm((prev) => ({ ...prev, notifyOnExit: checked }))} />
        <ToggleField label="applyPatch.enabled" checked={form.applyPatchEnabled} onChange={(checked) => setForm((prev) => ({ ...prev, applyPatchEnabled: checked }))} />
      </div>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存 Exec 配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function WebToolsForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<WebToolsFormState>(readWebToolsForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readWebToolsForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.tools?.web);
      const search = cloneRecord(next.search);
      search.enabled = form.searchEnabled;
      assignOptionalNumber(search, 'maxResults', form.searchMaxResults, 'tools.web.search.maxResults');
      assignOptionalNumber(search, 'timeoutSeconds', form.searchTimeoutSeconds, 'tools.web.search.timeoutSeconds');
      next.search = search;

      const fetchConfig = cloneRecord(next.fetch);
      fetchConfig.enabled = form.fetchEnabled;
      assignOptionalNumber(fetchConfig, 'maxChars', form.fetchMaxChars, 'tools.web.fetch.maxChars');
      assignOptionalNumber(fetchConfig, 'timeoutSeconds', form.fetchTimeoutSeconds, 'tools.web.fetch.timeoutSeconds');
      next.fetch = fetchConfig;

      await executeConfigUpdate('tools.web', next, '🕸️ Web 工具配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || 'Web 工具配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Web Tools" subtitle="写入 `tools.web`" />
      <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">Search</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ToggleField label="search.enabled" checked={form.searchEnabled} onChange={(checked) => setForm((prev) => ({ ...prev, searchEnabled: checked }))} />
          <div />
          <Field label="search.maxResults">
            <Input type="number" value={form.searchMaxResults} onChange={(event) => setForm((prev) => ({ ...prev, searchMaxResults: event.target.value }))} placeholder="5" />
          </Field>
          <Field label="search.timeoutSeconds">
            <Input type="number" value={form.searchTimeoutSeconds} onChange={(event) => setForm((prev) => ({ ...prev, searchTimeoutSeconds: event.target.value }))} placeholder="30" />
          </Field>
        </div>
      </div>
      <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">Fetch</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ToggleField label="fetch.enabled" checked={form.fetchEnabled} onChange={(checked) => setForm((prev) => ({ ...prev, fetchEnabled: checked }))} />
          <div />
          <Field label="fetch.maxChars">
            <Input type="number" value={form.fetchMaxChars} onChange={(event) => setForm((prev) => ({ ...prev, fetchMaxChars: event.target.value }))} placeholder="50000" />
          </Field>
          <Field label="fetch.timeoutSeconds">
            <Input type="number" value={form.fetchTimeoutSeconds} onChange={(event) => setForm((prev) => ({ ...prev, fetchTimeoutSeconds: event.target.value }))} placeholder="30" />
          </Field>
        </div>
      </div>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存 Web 工具配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function LoopDetectionForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<LoopDetectionFormState>(readLoopDetectionForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readLoopDetectionForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.tools?.loopDetection);
      next.enabled = form.enabled;
      assignOptionalNumber(next, 'historySize', form.historySize, 'tools.loopDetection.historySize');
      assignOptionalNumber(next, 'warningThreshold', form.warningThreshold, 'tools.loopDetection.warningThreshold');
      assignOptionalNumber(next, 'criticalThreshold', form.criticalThreshold, 'tools.loopDetection.criticalThreshold');
      assignOptionalNumber(next, 'globalCircuitBreakerThreshold', form.globalCircuitBreakerThreshold, 'tools.loopDetection.globalCircuitBreakerThreshold');
      await executeConfigUpdate('tools.loopDetection', next, '♻️ 循环检测配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '循环检测配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Loop Detection" subtitle="写入 `tools.loopDetection`" />
      <ToggleField label="enabled" checked={form.enabled} onChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="historySize">
          <Input type="number" value={form.historySize} onChange={(event) => setForm((prev) => ({ ...prev, historySize: event.target.value }))} placeholder="30" />
        </Field>
        <Field label="warningThreshold">
          <Input type="number" value={form.warningThreshold} onChange={(event) => setForm((prev) => ({ ...prev, warningThreshold: event.target.value }))} placeholder="10" />
        </Field>
        <Field label="criticalThreshold">
          <Input type="number" value={form.criticalThreshold} onChange={(event) => setForm((prev) => ({ ...prev, criticalThreshold: event.target.value }))} placeholder="20" />
        </Field>
        <Field label="globalCircuitBreakerThreshold">
          <Input type="number" value={form.globalCircuitBreakerThreshold} onChange={(event) => setForm((prev) => ({ ...prev, globalCircuitBreakerThreshold: event.target.value }))} placeholder="30" />
        </Field>
      </div>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存循环检测配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function SandboxForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<SandboxFormState>(readSandboxForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readSandboxForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.agents?.defaults?.sandbox);
      assignOptionalText(next, 'mode', form.mode);
      assignOptionalText(next, 'scope', form.scope);
      assignOptionalText(next, 'workspaceAccess', form.workspaceAccess);
      assignOptionalText(next, 'workspaceRoot', form.workspaceRoot);

      const docker = cloneRecord(next.docker);
      assignOptionalText(docker, 'image', form.dockerImage);
      assignOptionalText(docker, 'network', form.dockerNetwork);
      assignOptionalText(docker, 'memory', form.dockerMemory);
      assignOptionalNumber(docker, 'cpus', form.dockerCpus, 'sandbox.docker.cpus');
      assignOptionalText(docker, 'setupCommand', form.dockerSetupCommand);
      next.docker = docker;

      const browser = cloneRecord(next.browser);
      browser.enabled = form.browserEnabled;
      next.browser = browser;

      await executeConfigUpdate('agents.defaults.sandbox', next, '🧱 沙箱配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '沙箱配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Sandbox" subtitle="写入 `agents.defaults.sandbox`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="mode">
          <Select value={form.mode} onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value }))}>
            <option value="off">off</option>
            <option value="non-main">non-main</option>
            <option value="all">all</option>
          </Select>
        </Field>
        <Field label="scope">
          <Select value={form.scope} onChange={(event) => setForm((prev) => ({ ...prev, scope: event.target.value }))}>
            <option value="session">session</option>
            <option value="agent">agent</option>
            <option value="shared">shared</option>
          </Select>
        </Field>
        <Field label="workspaceAccess">
          <Select value={form.workspaceAccess} onChange={(event) => setForm((prev) => ({ ...prev, workspaceAccess: event.target.value }))}>
            <option value="none">none</option>
            <option value="ro">ro</option>
            <option value="rw">rw</option>
          </Select>
        </Field>
        <Field label="workspaceRoot">
          <Input value={form.workspaceRoot} onChange={(event) => setForm((prev) => ({ ...prev, workspaceRoot: event.target.value }))} placeholder="~/.openclaw/sandboxes" />
        </Field>
        <Field label="docker.image">
          <Input value={form.dockerImage} onChange={(event) => setForm((prev) => ({ ...prev, dockerImage: event.target.value }))} placeholder="openclaw-sandbox:bookworm-slim" />
        </Field>
        <Field label="docker.network">
          <Input value={form.dockerNetwork} onChange={(event) => setForm((prev) => ({ ...prev, dockerNetwork: event.target.value }))} placeholder="none / bridge / custom" />
        </Field>
        <Field label="docker.memory">
          <Input value={form.dockerMemory} onChange={(event) => setForm((prev) => ({ ...prev, dockerMemory: event.target.value }))} placeholder="1g" />
        </Field>
        <Field label="docker.cpus">
          <Input type="number" step="0.1" value={form.dockerCpus} onChange={(event) => setForm((prev) => ({ ...prev, dockerCpus: event.target.value }))} placeholder="1" />
        </Field>
        <Field className="sm:col-span-2" label="docker.setupCommand">
          <Textarea value={form.dockerSetupCommand} onChange={(event) => setForm((prev) => ({ ...prev, dockerSetupCommand: event.target.value }))} rows={4} placeholder="apt-get update && apt-get install -y git curl jq" />
        </Field>
      </div>
      <ToggleField label="browser.enabled" checked={form.browserEnabled} onChange={(checked) => setForm((prev) => ({ ...prev, browserEnabled: checked }))} />
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存沙箱配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function BrowserForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<BrowserFormState>(readBrowserForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readBrowserForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.browser);
      next.enabled = form.enabled;
      next.headless = form.headless;
      assignOptionalText(next, 'defaultProfile', form.profile);

      const ssrfPolicy = cloneRecord(next.ssrfPolicy);
      ssrfPolicy.dangerouslyAllowPrivateNetwork = !form.blockPrivateRanges;
      next.ssrfPolicy = ssrfPolicy;

      const profileName = form.profile.trim();
      if (profileName) {
        const profiles = cloneRecord(next.profiles);
        const profileConfig = cloneRecord(profiles[profileName]);
        assignOptionalNumber(profileConfig, 'cdpPort', form.cdpPort, 'browser.cdpPort');
        profiles[profileName] = profileConfig;
        next.profiles = profiles;
      }

      await executeConfigUpdate('browser', next, '🌐 浏览器配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '浏览器配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Browser" subtitle="写入 `browser`（映射 `defaultProfile` / `profiles` / `ssrfPolicy`）" />
      <div className="grid gap-3 sm:grid-cols-2">
        <ToggleField label="enabled" checked={form.enabled} onChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))} />
        <ToggleField label="headless" checked={form.headless} onChange={(checked) => setForm((prev) => ({ ...prev, headless: checked }))} />
        <Field label="profile">
          <Input value={form.profile} onChange={(event) => setForm((prev) => ({ ...prev, profile: event.target.value }))} placeholder="openclaw" />
        </Field>
        <Field label="cdpPort">
          <Input type="number" value={form.cdpPort} onChange={(event) => setForm((prev) => ({ ...prev, cdpPort: event.target.value }))} placeholder="18800" />
        </Field>
      </div>
      <ToggleField label="ssrf.blockPrivateRanges" checked={form.blockPrivateRanges} onChange={(checked) => setForm((prev) => ({ ...prev, blockPrivateRanges: checked }))} />
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存浏览器配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function LoggingForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<LoggingFormState>(readLoggingForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readLoggingForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.logging);
      assignOptionalText(next, 'level', form.level);
      assignOptionalText(next, 'file', form.file);
      next.redactSensitive = form.redact
        ? (typeof next.redactSensitive === 'string' && next.redactSensitive !== 'off' ? next.redactSensitive : 'tools')
        : 'off';
      await executeConfigUpdate('logging', next, '🪵 日志配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '日志配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Logging" subtitle="写入 `logging`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="level">
          <Select value={form.level} onChange={(event) => setForm((prev) => ({ ...prev, level: event.target.value }))}>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </Select>
        </Field>
        <Field label="file">
          <Input value={form.file} onChange={(event) => setForm((prev) => ({ ...prev, file: event.target.value }))} placeholder="/tmp/openclaw/openclaw.log" />
        </Field>
      </div>
      <ToggleField label="redact" checked={form.redact} onChange={(checked) => setForm((prev) => ({ ...prev, redact: checked }))} />
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存日志配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function DiscoveryForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<DiscoveryFormState>(readDiscoveryForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readDiscoveryForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.discovery);
      const wideArea = cloneRecord(next.wideArea);
      wideArea.enabled = form.enabled;
      next.wideArea = wideArea;

      const mdns = cloneRecord(next.mdns);
      mdns.mode = form.mdns ? (typeof mdns.mode === 'string' && mdns.mode !== 'off' ? mdns.mode : 'minimal') : 'off';
      next.mdns = mdns;

      await executeConfigUpdate('discovery', next, '🧭 发现配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '发现配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Discovery" subtitle="写入 `discovery`（映射 `wideArea.enabled` / `mdns.mode`）" />
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleField label="enabled" checked={form.enabled} onChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))} />
        <ToggleField label="mdns" checked={form.mdns} onChange={(checked) => setForm((prev) => ({ ...prev, mdns: checked }))} />
      </div>
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存发现配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function CanvasForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<CanvasFormState>(readCanvasForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readCanvasForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.canvasHost);
      assignOptionalText(next, 'root', form.root);
      next.liveReload = form.liveReload;
      await executeConfigUpdate('canvasHost', next, '🖼️ Canvas 配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || 'Canvas 配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Canvas Host" subtitle="写入 `canvasHost`" />
      <Field label="root">
        <Input value={form.root} onChange={(event) => setForm((prev) => ({ ...prev, root: event.target.value }))} placeholder="~/.openclaw/workspace/canvas" />
      </Field>
      <ToggleField label="liveReload" checked={form.liveReload} onChange={(checked) => setForm((prev) => ({ ...prev, liveReload: checked }))} />
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存 Canvas 配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function GatewayAdvancedForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<GatewayFormState>(readGatewayForm(config));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readGatewayForm(config));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const next = cloneRecord(config?.gateway);
      const auth = cloneRecord(next.auth);
      auth.mode = form.authEnabled
        ? (typeof auth.mode === 'string' && auth.mode && auth.mode !== 'none' ? auth.mode : 'token')
        : 'none';
      assignOptionalText(auth, 'token', form.authToken);
      next.auth = auth;

      const controlUi = cloneRecord(next.controlUi);
      controlUi.enabled = form.controlUi;
      next.controlUi = controlUi;

      await executeConfigUpdate('gateway', next, '🚪 Gateway 高级配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || 'Gateway 配置保存失败' });
    }
  }, [config, executeConfigUpdate, form, setResult]);

  return (
    <div className="space-y-3">
      <SectionTitle title="Gateway 高级" subtitle="写入 `gateway`" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="port">
          <Input value={form.port} readOnly className="opacity-70" />
        </Field>
        <ToggleField label="auth.enabled" checked={form.authEnabled} onChange={(checked) => setForm((prev) => ({ ...prev, authEnabled: checked }))} />
        <Field className="sm:col-span-2" label="auth.token">
          <Input type="password" value={form.authToken} onChange={(event) => setForm((prev) => ({ ...prev, authToken: event.target.value }))} placeholder="gateway token" />
        </Field>
      </div>
      <ToggleField label="controlUi" checked={form.controlUi} onChange={(checked) => setForm((prev) => ({ ...prev, controlUi: checked }))} />
      <SaveRow saving={saving} onSave={() => { void handleSave(); }} label="💾 保存 Gateway 配置" />
      <SaveResultBanner result={result} />
    </div>
  );
}

export function SkillsConfigForm({ config, onConfigRefresh }: SettingsFormProps) {
  const [form, setForm] = useState<JsonFormState>(readJsonForm(config?.skills));
  const { saving, result, setResult, executeConfigUpdate } = useConfigSection(onConfigRefresh);

  useEffect(() => {
    setForm(readJsonForm(config?.skills));
  }, [config]);

  const handleSave = useCallback(async () => {
    try {
      const parsed = parseJsonObject(form.json, 'skills');
      await executeConfigUpdate('skills', parsed, '🛠️ 技能配置已更新');
    } catch (err: any) {
      setResult({ ok: false, message: err.message || '技能配置保存失败' });
    }
  }, [executeConfigUpdate, form.json, setResult]);

  return (
    <JsonEditorForm
      title="Skills"
      subtitle="写入 `skills`"
      label="skills JSON"
      json={form.json}
      onChange={(value) => setForm({ json: value })}
      saving={saving}
      onSave={() => { void handleSave(); }}
      result={result}
      saveLabel="💾 保存技能配置"
    />
  );
}

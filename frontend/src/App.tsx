import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ReconnectBanner } from '@/components/hud/ReconnectBanner';
import { ResourceBar } from '@/components/hud/ResourceBar';
import { UnitCard } from '@/components/hud/UnitCard';
import { EventTicker } from '@/components/hud/EventTicker';
import { IncidentCenter } from '@/components/hud/IncidentCenter';
import { MorningBrief } from '@/components/hud/MorningBrief';
import { EntityRadar } from '@/components/hud/EntityRadar';
import { QuickActionBar } from '@/components/hud/QuickActionBar';
import { WelcomeOverlay } from '@/components/hud/WelcomeOverlay';
import { DeveloperFilter } from '@/components/controls/DeveloperFilter';
import { UserMenu } from '@/auth/UserMenu';
import { ChatDrawer } from '@/components/hud/ChatDrawer';
import { useSSE } from '@/hooks/use-sse';
import { setTokenGetter } from '@/lib/auth-fetch';
import { useWorldStore } from '@/store/world-store';
import type { EntityType } from '@/store/types';
import { useLogto } from '@logto/react';

// Lazy-loaded panels
const WorldCanvas = lazy(() => import('@/components/world/WorldCanvas').then(m => ({ default: m.WorldCanvas })));
const ChannelManager = lazy(() => import('@/components/controls/ChannelManager').then(m => ({ default: m.ChannelManager })));
const FileEditor = lazy(() => import('@/components/controls/FileEditor').then(m => ({ default: m.FileEditor })));
const MemoryPanel = lazy(() => import('@/components/controls/MemoryPanel').then(m => ({ default: m.MemoryPanel })));
const SkillManager = lazy(() => import('@/components/controls/SkillManager').then(m => ({ default: m.SkillManager })));
const PluginPanel = lazy(() => import('@/components/controls/PluginPanel').then(m => ({ default: m.PluginPanel })));
const ModelPanel = lazy(() => import('@/components/controls/ModelPanel').then(m => ({ default: m.ModelPanel })));
const ToolsPanel = lazy(() => import('@/components/controls/ToolsPanel').then(m => ({ default: m.ToolsPanel })));
const CronPanel = lazy(() => import('@/components/controls/CronPanel').then(m => ({ default: m.CronPanel })));
const GatewayPanel = lazy(() => import('@/components/controls/GatewayPanel').then(m => ({ default: m.GatewayPanel })));
const AgentPanel = lazy(() => import('@/components/controls/AgentPanel').then(m => ({ default: m.AgentPanel })));
const BindingsPanel = lazy(() => import('@/components/controls/BindingsPanel').then(m => ({ default: m.BindingsPanel })));
const SettingsPanel = lazy(() => import('@/components/controls/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const EnvPanel = lazy(() => import('@/components/controls/EnvPanel').then(m => ({ default: m.EnvPanel })));
const ActivityPanel = lazy(() => import('@/components/controls/ActivityPanel').then(m => ({ default: m.ActivityPanel })));

function PanelFallback() {
  return <div className="flex items-center justify-center p-8 text-slate-500"><span className="animate-pulse text-2xl">⏳</span></div>;
}

// ── Panel state: one panel open at a time in the right-bottom slot ──
type PanelState =
  | { type: 'gateway' }
  | { type: 'bindings' }
  | { type: 'settings' }
  | { type: 'env' }
  | { type: 'agent'; agentId: string }
  | { type: 'session' }
  | { type: 'channel' }
  | { type: 'skill'; agentId?: string }
  | { type: 'plugin' }
  | { type: 'model' }
  | { type: 'tools' }
  | { type: 'cron' }
  | { type: 'file'; agentId: string; file?: string }
  | { type: 'memory'; agentId: string };

export default function App() {
  const { getAccessToken } = useLogto();

  const getToken = useCallback(async () => {
    try {
      return await getAccessToken();
    } catch {
      return undefined;
    }
  }, [getAccessToken]);

  // Synchronously set tokenGetter during render so child effects can use it
  // immediately. React fires child useEffects BEFORE parent useEffects, so
  // deferring this to a useEffect causes a race condition where WorldCanvas
  // calls authFetch before tokenGetter is set.
  setTokenGetter(getToken);
  useEffect(() => {
    return () => setTokenGetter(null);
  }, []);

  useSSE('/clawcraft/events', getToken);

  const agents = useWorldStore((s) => s.agents);
  const selectedEntityId = useWorldStore((s) => s.selectedEntityId);
  const selectedEntityType = useWorldStore((s) => s.selectedEntityType);
  const clearSelection = useWorldStore((s) => s.clearSelection);
  const selectEntity = useWorldStore((s) => s.selectEntity);
  const chatDrawerOpen = useWorldStore((s) => s.chatDrawerOpen);
  const setChatDrawerOpen = useWorldStore((s) => s.setChatDrawerOpen);
  const requestChatFocus = useWorldStore((s) => s.requestChatFocus);
  const activityPanelOpen = useWorldStore((s) => s.activityPanelOpen);
  const setActivityPanelOpen = useWorldStore((s) => s.setActivityPanelOpen);
  const agentIds = Object.keys(agents).sort();

  const [activePanel, setActivePanel] = useState<PanelState | null>(null);
  const [prevPanel, setPrevPanel] = useState<PanelState | null>(null);
  const [panelTransition, setPanelTransition] = useState(false);
  const [panelHeight, setPanelHeight] = useState<'min' | 'mid' | 'max'>('mid');
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('clawcraft-welcomed'));

  // Panel switch with cross-fade
  const switchPanel = useCallback((next: PanelState | null) => {
    if (!next) { setActivePanel(null); return; }
    if (activePanel && activePanel.type !== next.type) {
      setPanelTransition(true);
      setPrevPanel(activePanel);
      setTimeout(() => {
        setActivePanel(next);
        setPanelTransition(false);
        setPrevPanel(null);
      }, 150); // 150ms cross-fade
    } else {
      setActivePanel(next);
    }
  }, [activePanel]);
  // ── Entity click handler: open the right panel for each entity type ──
  const handleEntityClick = useCallback((entityId: string, entityType: EntityType) => {
    setPanelHeight('mid'); // Reset panel height on new selection
    switch (entityType) {
      case 'gateway':
        switchPanel({ type: 'gateway' });
        break;
      case 'agent':
        selectEntity(entityId, entityType);
        switchPanel({ type: 'agent', agentId: entityId });
        break;
      case 'session':
        // Select session in store so UnitCard shows it
        selectEntity(entityId, entityType);
        switchPanel({ type: 'session' });
        break;
      case 'building':
        handleBuildingClick(entityId);
        break;
    }
  }, [selectEntity, switchPanel]);

  // ── Building click → open building-specific panel ──
  const handleBuildingClick = useCallback((buildingId: string) => {
    if (buildingId.startsWith('skills:')) {
      const agentId = buildingId.split(':')[1];
      if (agentId) {
        switchPanel({ type: 'skill', agentId });
        return;
      }
    }

    if (buildingId.startsWith('memory:')) {
      const agentId = buildingId.split(':')[1];
      if (agentId) {
        switchPanel({ type: 'memory', agentId });
        return;
      }
    }

    if (buildingId.startsWith('files:')) {
      const agentId = buildingId.split(':')[1];
      if (agentId) {
        switchPanel({ type: 'file', agentId });
        return;
      }
    }

    switch (buildingId) {
      case 'gateway':                    switchPanel({ type: 'gateway' }); break;
      case 'channel':  case 'channels':  switchPanel({ type: 'channel' }); break;
      case 'skill':    case 'skills':    switchPanel({ type: 'skill' }); break;
      case 'plugin':   case 'plugins':   switchPanel({ type: 'plugin' }); break;
      case 'memory':                     switchPanel({ type: 'memory', agentId: 'main' }); break;
      case 'model':    case 'models':    switchPanel({ type: 'model' }); break;
      case 'files':                      switchPanel({ type: 'file', agentId: 'main' }); break;
      case 'tools':                      switchPanel({ type: 'tools' }); break;
      case 'cron':    case 'crons':      switchPanel({ type: 'cron' }); break;
      case 'bindings':                   switchPanel({ type: 'bindings' }); break;
      case 'settings':                   switchPanel({ type: 'settings' }); break;
      case 'env':                        switchPanel({ type: 'env' }); break;
      default:
        console.warn('[ClawCraft] Unknown building:', buildingId);
        break;
    }
  }, [switchPanel]);

  // Expose for e2e testing
  useEffect(() => {
    (window as any).__buildingClick = handleBuildingClick;
    (window as any).__entityClick = handleEntityClick;
    return () => {
      delete (window as any).__buildingClick;
      delete (window as any).__entityClick;
    };
  }, [handleBuildingClick, handleEntityClick]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const nextOpen = !useWorldStore.getState().chatDrawerOpen;
        setChatDrawerOpen(nextOpen);
        if (nextOpen) {
          window.setTimeout(() => requestChatFocus(), 0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestChatFocus, setChatDrawerOpen]);

  // Click on empty area to close everything
  const handleWorldClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.worldBg) {
      clearSelection();
      setActivePanel(null);
    }
  }, [clearSelection]);

  // Prevent default context menu (no right-click menu)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // ── Render active panel in the right-bottom slot ──
  function renderPanel() {
    if (!activePanel) return null;

    const close = () => setActivePanel(null);

    switch (activePanel.type) {
      case 'gateway':
        return (
          <GatewayPanel
            onClose={close}
            onOpenBindings={() => switchPanel({ type: 'bindings' })}
            onOpenSettings={() => switchPanel({ type: 'settings' })}
          />
        );
      case 'bindings':
        return <BindingsPanel onClose={close} />;
      case 'settings':
        return (
          <SettingsPanel
            onClose={close}
            onOpenBuilding={handleBuildingClick}
            onOpenAgent={(agentId) => switchPanel({ type: 'agent', agentId })}
          />
        );
      case 'env':
        return <EnvPanel onClose={close} />;
      case 'agent':
        return <AgentPanel agentId={activePanel.agentId} onClose={close} />;
      case 'session':
        return <UnitCard />;
      case 'channel':
        return <ChannelManager onClose={close} inline />;
      case 'skill':
        return <SkillManager onClose={close} inline />;
      case 'plugin':
        return <PluginPanel onClose={close} />;
      case 'model':
        return <ModelPanel onClose={close} />;
      case 'tools':
        return <ToolsPanel onClose={close} />;
      case 'cron':
        return <CronPanel onClose={close} />;
      case 'file':
        return <FileEditor agentId={activePanel.agentId} initialFile={activePanel.file} onClose={close} inline />;
      case 'memory':
        return <MemoryPanel agentId={activePanel.agentId} onClose={close} inline />;
      default:
        return null;
    }
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      data-world-bg="true"
      onClick={handleWorldClick}
      onContextMenu={handleContextMenu}
    >
      {/* ── Full-screen World Canvas ── */}
      <Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-slate-950 text-slate-500"><span className="animate-pulse text-4xl">🏰</span></div>}>
        <WorldCanvas onEntityClick={handleEntityClick} />
      </Suspense>

      {/* ── Reconnect Banner ── */}
      <ReconnectBanner />

      {/* ── Top Left: Resource Bar ── */}
      <div className="pointer-events-auto absolute left-4 top-4 z-20">
        <ResourceBar />
      </div>

      {/* ── Top Left Below: Incident Center ── */}
      <div className="pointer-events-auto absolute left-4 top-24 z-20 w-[280px]">
        <IncidentCenter />
      </div>

      {/* ── Morning Brief ── */}
      <MorningBrief />

      {/* ── Top Right: User Menu + Developer Filter ── */}
      <div className="pointer-events-auto absolute right-4 top-4 z-20 flex items-center gap-3">
        <UserMenu />
        <DeveloperFilter />
      </div>

      {/* ── Right Side: Event Ticker ── */}
      <div className={`pointer-events-auto absolute top-16 z-20 w-[300px] transition-all duration-300 ${chatDrawerOpen ? 'right-[420px] hidden xl:block' : 'right-4'}`}>
        <EventTicker />
      </div>

      <EntityRadar />

      <QuickActionBar
        onOpenGateway={() => handleEntityClick('gateway', 'gateway')}
        onOpenBuilding={handleBuildingClick}
        onOpenAgent={(agentId) => handleEntityClick(agentId, 'agent')}
        onToggleChat={() => setChatDrawerOpen(!chatDrawerOpen)}
        onToggleActivity={() => setActivityPanelOpen(!activityPanelOpen)}
        agentIds={agentIds}
      />

      {/* ── Bottom Left: Home Button ── */}
      <div className="pointer-events-auto absolute bottom-4 left-4 z-20 sm:bottom-20">
        <button
          onClick={() => (window as any).__resetView?.()}
          className="rounded-xl border border-slate-700/50 bg-slate-900/80 px-3 py-2 text-sm text-slate-300 backdrop-blur-sm hover:bg-slate-800/80 hover:text-slate-100 transition-colors"
          title="回到中心视角 (R)"
        >
          🏠 回到中心
        </button>
      </div>

      {/* ── Panel Backdrop (mobile): prevents gesture passthrough ── */}
      {activePanel && (
        <div
          className="pointer-events-auto absolute inset-0 z-10 bg-black/20 sm:hidden"
          onClick={() => setActivePanel(null)}
        />
      )}

      {/* ── Bottom Right (desktop) / Bottom Sheet (mobile): Panel Slot ── */}
      <div className={`pointer-events-auto absolute bottom-0 right-0 z-20 w-full sm:bottom-4 sm:right-4 sm:w-[420px] sm:max-h-[70vh] overflow-hidden transition-all duration-300 ease-out ${activePanel ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'} ${panelHeight === 'min' ? 'max-h-[25vh] sm:max-h-[70vh]' : panelHeight === 'max' ? 'max-h-[95vh] sm:max-h-[70vh]' : 'max-h-[60vh] sm:max-h-[70vh]'}`}>
        {/* Mobile: Panel height toggle */}
        {activePanel && (
          <div className="flex items-center justify-center gap-2 py-1 sm:hidden bg-slate-900/90 border-b border-slate-700/30">
            {(['min', 'mid', 'max'] as const).map((h) => (
              <button
                key={h}
                onClick={() => setPanelHeight(h)}
                className={`w-8 h-1.5 rounded-full transition-colors ${panelHeight === h ? 'bg-slate-400' : 'bg-slate-700'}`}
              />
            ))}
          </div>
        )}
        <Suspense fallback={<PanelFallback />}>
          <div className={`transition-opacity duration-150 ${panelTransition ? 'opacity-0' : 'opacity-100'}`}>
            {renderPanel()}
          </div>
        </Suspense>
      </div>

      <ChatDrawer />

      {activityPanelOpen ? (
        <Suspense fallback={<PanelFallback />}>
          <ActivityPanel open={activityPanelOpen} onClose={() => setActivityPanelOpen(false)} />
        </Suspense>
      ) : null}

      {showWelcome && (
        <WelcomeOverlay
          onClose={() => {
            setShowWelcome(false);
            localStorage.setItem('clawcraft-welcomed', '1');
          }}
        />
      )}
    </div>
  );
}

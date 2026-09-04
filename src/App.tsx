import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import ActionButtons from './components/ActionButtons';
import OverviewPanel from './components/OverviewPanel';
import SettingsView from './components/SettingsView';
import type { ThemeName } from './components/ThemeSelector';
import TabSwitcher, { TabName } from './components/TabSwitcher';
import ClaudePanel from './components/ClaudePanel';
import CodexPanel from './components/CodexPanel';
import CursorPanel from './components/CursorPanel';
import GrokPanel from './components/GrokPanel';
import AntigravityPanel from './components/AntigravityPanel';
import type { TrayToggleEntry } from './components/TrayToggles';
import { backend, hasTauriBackend } from './services/backend';
import { SERVICE_META, SERVICES } from './services/service_meta';
import { resolveTrayVisible, saveTrayEnabled, shouldShowTray, type TrayServiceName } from './services/tray_visibility';
import {
  getSavedPanelSections,
  savePanelSections,
  type PanelSectionKey,
  type PanelSectionVisibility,
} from './services/panel_sections';
import {
  getSavedTrayCycle,
  getSavedTrayStyle,
  saveTrayCycle,
  saveTrayStyle,
  type TrayStyle,
} from './services/tray_style';
import { appendEvent, getSavedEvents, persistEvents, type AppEvent, type EventLevel } from './services/event_log';
import {
  getSavedSwitcherVisibility,
  saveSwitcherVisibility,
  type SwitcherVisibility,
} from './services/switcher_providers';
import {
  createNotificationFailureOptions,
  getSavedNotificationSettings,
  notify,
  saveNotificationSettings,
  type NotificationKey,
  type NotificationSettings,
} from './services/notifications';
import {
  buildClaudeQuotaWindows,
  buildProviderSummaries,
  isProviderTab,
  sortMostConstrained,
  sortUpcomingResets,
  type AppViewName,
  type QuotaWindowSummary,
} from './services/provider_summary';
import type { QuotaData } from './types/models';
import './styles/foundation.css';
import './styles/content.css';
import './styles/views.css';
import './redesign/shell.css';
import './redesign/panels.css';
import './redesign-settings.css';

import {
  AUTO_REFRESH_INTERVAL_MS,
  TRAY_CYCLE_INTERVAL_MS,
  TRAY_FORCE_SYNC_INTERVAL_MS,
  TRAY_GUARD_MESSAGE,
  TRAY_GUARD_TOAST_MS,
  TRAY_SERVICE_ACTIVATED_EVENT,
  VALID_TABS,
  defaultServiceMap,
  getClaudeRefreshIntervalMs,
  getClaudeTrayUsedPercent,
  keepClaudeQuotaOnError,
  getInitialTrayEnabledState,
  getSavedDockHidden,
  getSavedSettingsExpanded,
  getSavedTab,
  getSavedTheme,
  isMacOSPlatform,
  providerRefreshIntervalMs,
  saveActiveTab,
  saveDockHidden,
  saveSettingsExpanded,
  saveTheme,
  type ServiceMap,
  type TrayEnabledState,
  type TrayIconRequest,
  type TrayServiceActivatedPayload,
} from './services/app_state';
import {
  STORAGE_READ_FAILURE_MESSAGE,
  STORAGE_WRITE_FAILURE_MESSAGE,
  subscribeStorageReadFailures,
  subscribeStorageWriteFailures,
} from './services/storage';
import { bonusReadyEntered, formatBonusReadyMessage } from './services/bonus_ready';
import { planProviderPreset, planRevealProviderPanel, type ProviderPreset } from './services/provider_presets';
import { useServiceEvents } from './hooks/use_service_events';
import { usePopoverWindow } from './hooks/use_popover_window';
import { useLatestRequestGeneration } from './hooks/use_latest_request_generation';
import { useFooterStatus } from './hooks/use_footer_status';

// Re-exported for existing tests/importers.
export {
  AUTO_REFRESH_INTERVAL_MS,
  BACKOFF_REFRESH_INTERVAL_MS,
  AUTH_REFRESH_INTERVAL_MS,
  BACKGROUND_REFRESH_INTERVAL_MS,
  getClaudeRefreshIntervalMs,
  getClaudeTrayUsedPercent,
  keepClaudeQuotaOnError,
  providerRefreshIntervalMs,
} from './services/app_state';

type ToastValue = string | null;
type ToastSetter = (value: ToastValue | ((current: ToastValue) => ToastValue)) => void;
type ToastScheduler = (callback: () => void, delayMs: number) => void;

const SWITCHER_GUARD_MESSAGE = 'At least one provider must stay in the switcher';

const scheduleToastClear: ToastScheduler = (callback, delayMs) => {
  setTimeout(callback, delayMs);
};

export function subscribeStorageReadFailureToast(
  setToast: ToastSetter,
  schedule: ToastScheduler = scheduleToastClear,
): () => void {
  return subscribeStorageReadFailures(() => {
    setToast(STORAGE_READ_FAILURE_MESSAGE);
    schedule(() => setToast(null), TRAY_GUARD_TOAST_MS);
  });
}

export default function App() {
  const isMacOS = isMacOSPlatform();

  // Claude state (still owned by App because of adaptive backoff)
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [claudeCostRefreshNonce, setClaudeCostRefreshNonce] = useState(0);
  const claudeIntervalRef = useRef(AUTO_REFRESH_INTERVAL_MS);
  const claude_request_generation = useLatestRequestGeneration();

  // Per-service connection + usage state (set via Panel callbacks)
  const [connected, setConnected] = useState<ServiceMap<boolean>>(() => defaultServiceMap(false));
  const [usedPercent, setUsedPercent] = useState<ServiceMap<number | null>>(() =>
    defaultServiceMap<number | null>(null),
  );
  const [panelLoading, setPanelLoading] = useState<ServiceMap<boolean>>(() => defaultServiceMap(false));
  const [providerQuotaWindows, setProviderQuotaWindows] = useState<ServiceMap<QuotaWindowSummary[]>>(() =>
    defaultServiceMap<QuotaWindowSummary[]>([]),
  );

  // Manual refresh nonces (per non-Claude service)
  const [refreshNonces, setRefreshNonces] = useState<ServiceMap<number>>(() => defaultServiceMap(0));

  // UI state
  const [theme, setTheme] = useState<ThemeName>(getSavedTheme);
  const [dockHidden, setDockHidden] = useState<boolean>(getSavedDockHidden);
  const [trayEnabled, setTrayEnabled] = useState<TrayEnabledState>(getInitialTrayEnabledState);
  const [toast, setToastState] = useState<ToastValue>(null);
  const switcherGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setToast = useCallback<ToastSetter>((value) => {
    setToastState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      return next === null && current === SWITCHER_GUARD_MESSAGE && switcherGuardTimerRef.current !== null
        ? current
        : next;
    });
  }, []);
  const [activeView, setActiveView] = useState<AppViewName>(() =>
    getSavedSettingsExpanded() ? 'settings' : getSavedTab(),
  );
  const [lastProviderTab, setLastProviderTab] = useState<TrayServiceName>(() => {
    const saved = getSavedTab();
    return isProviderTab(saved) ? saved : 'claude';
  });
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [panelSections, setPanelSections] = useState<PanelSectionVisibility>(getSavedPanelSections);
  const [trayStyle, setTrayStyle] = useState<TrayStyle>(getSavedTrayStyle);
  const [trayCycle, setTrayCycle] = useState<boolean>(getSavedTrayCycle);
  const [trayCycleIndex, setTrayCycleIndex] = useState(0);
  const [events, setEvents] = useState<AppEvent[]>(getSavedEvents);
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(getSavedNotificationSettings);
  const bonusReadyPrevRef = useRef<{ exhausted: boolean; availableCount: number } | null>(null);
  const [switcherVisibility, setSwitcherVisibility] = useState<SwitcherVisibility>(getSavedSwitcherVisibility);
  const containerRef = useRef<HTMLDivElement>(null);
  const windowVisible = usePopoverWindow(containerRef, [activeView, quota, connected]);
  const lastTrayIconRequestRef = useRef<Partial<Record<TrayServiceName, TrayIconRequest>>>({});

  const setServiceConnected = useCallback((service: TrayServiceName, value: boolean) => {
    setConnected((prev) => (prev[service] === value ? prev : { ...prev, [service]: value }));
  }, []);

  const setServiceUsedPercent = useCallback((service: TrayServiceName, value: number | null) => {
    setUsedPercent((prev) => (prev[service] === value ? prev : { ...prev, [service]: value }));
  }, []);

  const setServiceLoading = useCallback((service: TrayServiceName, value: boolean) => {
    setPanelLoading((prev) => (prev[service] === value ? prev : { ...prev, [service]: value }));
  }, []);

  const connectionSetters = useMemo<ServiceMap<(value: boolean) => void>>(() => {
    const setters = {} as ServiceMap<(value: boolean) => void>;
    for (const svc of SERVICES) {
      setters[svc] = (value) => setServiceConnected(svc, value);
    }
    return setters;
  }, [setServiceConnected]);

  const usageSetters = useMemo<ServiceMap<(value: number | null) => void>>(() => {
    const setters = {} as ServiceMap<(value: number | null) => void>;
    for (const svc of SERVICES) {
      setters[svc] = (value) => setServiceUsedPercent(svc, value);
    }
    return setters;
  }, [setServiceUsedPercent]);

  const loadingSetters = useMemo<ServiceMap<(value: boolean) => void>>(() => {
    const setters = {} as ServiceMap<(value: boolean) => void>;
    for (const svc of SERVICES) {
      setters[svc] = (value) => setServiceLoading(svc, value);
    }
    return setters;
  }, [setServiceLoading]);

  const quotaWindowSetters = useMemo<ServiceMap<(windows: QuotaWindowSummary[]) => void>>(() => {
    const setters = {} as ServiceMap<(windows: QuotaWindowSummary[]) => void>;
    for (const svc of SERVICES) {
      setters[svc] = (windows) => {
        setProviderQuotaWindows((prev) => ({ ...prev, [svc]: windows }));
      };
    }
    return setters;
  }, []);

  const showTimedToast = useCallback((message: string, delayMs = TRAY_GUARD_TOAST_MS) => {
    if (timedToastTimerRef.current !== null) {
      clearTimeout(timedToastTimerRef.current);
    }
    setToast(message);
    timedToastTimerRef.current = setTimeout(() => {
      timedToastTimerRef.current = null;
      setToast((current) => current === message ? null : current);
    }, delayMs);
  }, [setToast]);

  const showStorageWriteFailure = useCallback(() => {
    showTimedToast(STORAGE_WRITE_FAILURE_MESSAGE);
  }, [showTimedToast]);

  useEffect(() => {
    return subscribeStorageWriteFailures(showStorageWriteFailure);
  }, [showStorageWriteFailure]);

  useEffect(() => {
    return subscribeStorageReadFailureToast(setToast);
  }, [setToast]);

  const setAndPersistTab = useCallback((tab: TabName) => {
    setActiveView(tab);
    if (isProviderTab(tab)) {
      setLastProviderTab(tab);
    }
    saveActiveTab(tab);
    saveSettingsExpanded(false);
  }, []);

  const updateTrayIcon = useCallback(async (
    service: TrayServiceName,
    percentage: number | null,
    visible: boolean,
    force = false,
    style: TrayStyle = 'percent',
  ) => {
    const previous = lastTrayIconRequestRef.current[service];
    if (
      !force &&
      previous?.percentage === percentage &&
      previous.visible === visible &&
      previous.style === style
    ) {
      return;
    }

    try {
      await backend.updateTrayIcon(service, percentage, visible, force, style);
      lastTrayIconRequestRef.current[service] = { percentage, visible, style };
    } catch (err) {
      console.error(`Failed to update ${service} tray icon:`, err);
    }
  }, []);

  // Fetch Claude quota for startup/manual/background refresh.
  const fetchClaudeQuota = useCallback(async () => {
    const generation = claude_request_generation.begin();
    try {
      setClaudeLoading(true);
      setClaudeError(null);
      const data = await backend.getQuota();
      if (!claude_request_generation.isCurrent(generation)) return;

      if (data.error) {
        setClaudeError(data.error);
        if (keepClaudeQuotaOnError(data)) {
          if (data.connected) {
            setQuota(data);
          }
        } else {
          setQuota(null);
        }
        claudeIntervalRef.current = getClaudeRefreshIntervalMs(data.error);
      } else {
        setQuota(data);
        setClaudeError(null);
        claudeIntervalRef.current = AUTO_REFRESH_INTERVAL_MS;
      }
      setServiceConnected('claude', data.connected);
    } catch (err) {
      if (!claude_request_generation.isCurrent(generation)) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      setClaudeError(message);
      claudeIntervalRef.current = getClaudeRefreshIntervalMs(message);
      setServiceConnected('claude', false);
    } finally {
      if (claude_request_generation.isCurrent(generation)) {
        setClaudeLoading(false);
      }
    }
  }, [claude_request_generation, setServiceConnected]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const run = async () => {
      await fetchClaudeQuota();
      if (!cancelled) {
        timer = setTimeout(run, claudeIntervalRef.current);
      }
    };

    run();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [fetchClaudeQuota]);

  useEffect(() => {
    setServiceUsedPercent('claude', getClaudeTrayUsedPercent(quota));
  }, [quota, setServiceUsedPercent]);

  const syncTrayIcons = useCallback((force = false) => {
    const candidates = SERVICES.filter((svc) => {
      const isConnected = svc === 'claude' ? quota?.connected ?? false : connected[svc];
      return shouldShowTray(trayEnabled[svc], isConnected);
    });

    for (const svc of SERVICES) {
      const pct = svc === 'claude' ? getClaudeTrayUsedPercent(quota) : usedPercent[svc];
      const visible = resolveTrayVisible(svc, candidates, trayCycle, trayCycleIndex);
      updateTrayIcon(svc, pct, visible, force, trayStyle);
    }
  }, [quota, connected, usedPercent, trayEnabled, trayCycle, trayCycleIndex, trayStyle, updateTrayIcon]);

  useEffect(() => {
    syncTrayIcons();
  }, [syncTrayIcons]);

  useEffect(() => {
    const interval = setInterval(() => {
      syncTrayIcons(true);
    }, TRAY_FORCE_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [syncTrayIcons]);

  useEffect(() => {
    if (!trayCycle) return;
    const interval = setInterval(() => {
      setTrayCycleIndex((index) => index + 1);
    }, TRAY_CYCLE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [trayCycle]);

  const logEvent = useCallback((level: EventLevel, text: string) => {
    const now = Date.now();
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    setEvents((prev) => appendEvent(prev, level, text, now, id));
  }, []);

  useEffect(() => {
    persistEvents(events);
  }, [events]);

  useServiceEvents(quota, connected, usedPercent, notifSettings, logEvent);

  const showSwitcherGuardToast = useCallback(() => {
    if (switcherGuardTimerRef.current !== null) {
      clearTimeout(switcherGuardTimerRef.current);
    }
    setToast(SWITCHER_GUARD_MESSAGE);
    switcherGuardTimerRef.current = setTimeout(() => {
      switcherGuardTimerRef.current = null;
      setToast((current) => current === SWITCHER_GUARD_MESSAGE ? null : current);
    }, TRAY_GUARD_TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (switcherGuardTimerRef.current !== null) {
      clearTimeout(switcherGuardTimerRef.current);
      switcherGuardTimerRef.current = null;
    }
    if (timedToastTimerRef.current !== null) {
      clearTimeout(timedToastTimerRef.current);
      timedToastTimerRef.current = null;
    }
  }, []);

  const handleSwitcherToggle = useCallback((service: TrayServiceName) => {
    const nextValue = !switcherVisibility[service];
    if (!nextValue && !SERVICES.some((other) => other !== service && switcherVisibility[other])) {
      showSwitcherGuardToast();
      return;
    }
    const next = { ...switcherVisibility, [service]: nextValue };
    setSwitcherVisibility(next);
    saveSwitcherVisibility(next);
  }, [showSwitcherGuardToast, switcherVisibility]);

  // If the active provider tab gets hidden from the switcher, fall back to Overview.
  useEffect(() => {
    if (isProviderTab(activeView) && !switcherVisibility[activeView]) {
      setAndPersistTab('all');
    }
  }, [activeView, switcherVisibility, setAndPersistTab]);

  const handleNotificationToggle = useCallback((key: NotificationKey) => {
    const next = { ...notifSettings, [key]: !notifSettings[key] };
    saveNotificationSettings(next);
    setNotifSettings(next);
  }, [notifSettings]);

  const handleBonusExpiring = useCallback((daysLeft: number) => {
    const text = daysLeft <= 0
      ? 'Codex bonus reset expires today'
      : `Codex bonus reset expires in ${daysLeft}d`;
    logEvent('warning', text);
    if (notifSettings.bonus) {
      void notify('QuotaBar', text, createNotificationFailureOptions(logEvent));
    }
  }, [logEvent, notifSettings.bonus]);

  const handleBonusReadyChange = useCallback((ready: { exhausted: boolean; availableCount: number }) => {
    const prev = bonusReadyPrevRef.current;
    bonusReadyPrevRef.current = ready;
    if (!bonusReadyEntered(prev, ready)) return;
    const text = formatBonusReadyMessage(ready.availableCount);
    logEvent('warning', text);
    if (notifSettings.bonusReady) {
      void notify('QuotaBar', text, createNotificationFailureOptions(logEvent));
    }
  }, [logEvent, notifSettings.bonusReady]);

  const applyProviderPreset = useCallback((preset: ProviderPreset) => {
    const plan = planProviderPreset(switcherVisibility, trayEnabled, preset);
    setSwitcherVisibility(plan.switcher);
    saveSwitcherVisibility(plan.switcher);
    const trayChanged = SERVICES.some((service) => plan.trays[service] !== trayEnabled[service]);
    if (!trayChanged) return;
    setTrayEnabled(plan.trays);
    for (const service of SERVICES) {
      if (plan.trays[service] !== trayEnabled[service]) {
        saveTrayEnabled(service, plan.trays[service]);
      }
    }
  }, [switcherVisibility, trayEnabled]);

  const handleSelectEventProvider = useCallback((service: TrayServiceName) => {
    const next = planRevealProviderPanel(switcherVisibility, service);
    if (next !== switcherVisibility) {
      setSwitcherVisibility(next);
      saveSwitcherVisibility(next);
    }
    setAndPersistTab(service);
  }, [setAndPersistTab, switcherVisibility]);

  const handleTrayStyleChange = useCallback((style: TrayStyle) => {
    saveTrayStyle(style);
    setTrayStyle(style);
  }, []);

  const handleTrayCycleToggle = useCallback(() => {
    const next = !trayCycle;
    saveTrayCycle(next);
    setTrayCycle(next);
    setTrayCycleIndex(0);
  }, [trayCycle]);

  const handleThemeChange = useCallback((newTheme: ThemeName) => {
    setTheme(newTheme);
    saveTheme(newTheme);
  }, []);

  useEffect(() => {
    backend.setDockVisibility(!dockHidden).catch((err) => {
      console.error('Failed to apply dock visibility:', err);
    });
  }, [dockHidden]);

  const handleDockToggle = useCallback(() => {
    const newValue = !dockHidden;
    saveDockHidden(newValue);
    setDockHidden(newValue);
  }, [dockHidden]);

  const showTrayGuardToast = useCallback(() => {
    showTimedToast(TRAY_GUARD_MESSAGE);
  }, [showTimedToast]);

  const handleTrayToggle = useCallback((service: TrayServiceName) => {
    const nextValue = !trayEnabled[service];
    const someOtherEnabled = SERVICES.some((other) => other !== service && trayEnabled[other]);
    if (!nextValue && !someOtherEnabled) {
      showTrayGuardToast();
      return;
    }
    saveTrayEnabled(service, nextValue);
    setTrayEnabled((prev) => ({
      ...prev,
      [service]: nextValue,
    }));
  }, [showTrayGuardToast, trayEnabled]);

  const handlePanelSectionToggle = useCallback((key: PanelSectionKey) => {
    const next = { ...panelSections, [key]: !panelSections[key] };
    savePanelSections(next);
    setPanelSections(next);
  }, [panelSections]);

  const handleTabChange = useCallback((tab: TabName) => {
    setAndPersistTab(tab);
  }, [setAndPersistTab]);

  useEffect(() => {
    if (!hasTauriBackend()) return;
    let unlisten: (() => void) | null = null;
    let mounted = true;

    listen<TrayServiceActivatedPayload>(TRAY_SERVICE_ACTIVATED_EVENT, (event) => {
      const service = event.payload?.service;
      if (service && VALID_TABS.has(service)) {
        setAndPersistTab(service);
      }
    })
      .then((stopListening) => {
        if (mounted) {
          unlisten = stopListening;
          return;
        }
        stopListening();
      })
      .catch((error) => {
        console.error('Failed to subscribe tray activation event:', error);
      });

    return () => {
      mounted = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [setAndPersistTab]);

  const activeProvider = isProviderTab(activeView) ? activeView : lastProviderTab;
  const activeTab: TabName = activeView === 'all' ? 'all' : activeProvider;

  const handleRefresh = useCallback(() => {
    if (activeView === 'all') {
      fetchClaudeQuota();
      setClaudeCostRefreshNonce((value) => value + 1);
      setRefreshNonces((prev) => {
        const next = { ...prev };
        for (const svc of SERVICES) {
          next[svc] += 1;
        }
        return next;
      });
      return;
    }
    if (activeProvider === 'claude') {
      fetchClaudeQuota();
      setClaudeCostRefreshNonce((value) => value + 1);
      return;
    }
    setRefreshNonces((prev) => ({ ...prev, [activeProvider]: prev[activeProvider] + 1 }));
  }, [activeProvider, activeView, fetchClaudeQuota]);

  const handleOpenDashboard = useCallback(async () => {
    try {
      switch (activeProvider) {
        case 'claude':
          await backend.openClaudeDashboard();
          break;
        case 'codex':
          await backend.openCodexDashboard();
          break;
        case 'cursor':
          await backend.openCursorDashboard();
          break;
        case 'grok':
          await backend.openGrokDashboard();
          break;
        case 'antigravity':
          await backend.openAntigravityDashboard();
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open dashboard';
      showTimedToast(message);
    }
  }, [activeProvider, showTimedToast]);

  const handleSettingsViewToggle = useCallback(() => {
    const opening = activeView !== 'settings';
    saveSettingsExpanded(opening);
    setActiveView(opening ? 'settings' : getSavedTab());
  }, [activeView]);

  const handleCloseSettings = useCallback(() => {
    saveSettingsExpanded(false);
    setActiveView(getSavedTab());
  }, []);

  const handleQuit = async () => {
    try {
      await backend.quitApp();
    } catch (err) {
      console.error('Failed to quit:', err);
    }
  };

  const trayEntries: TrayToggleEntry[] = SERVICES.map((svc) => {
    const meta = SERVICE_META[svc];
    const otherEnabled = SERVICES.some((other) => other !== svc && trayEnabled[other]);
    const isConnected = svc === 'claude' ? quota?.connected ?? false : connected[svc];
    return {
      service: svc,
      label: meta.trayLabel,
      enabled: trayEnabled[svc],
      canDisable: otherEnabled,
      connected: isConnected,
      connectedHint: meta.connectedHint,
      disconnectedHint: meta.disconnectedHint,
    };
  });

  const tabConnected: ServiceMap<boolean> = {
    claude: quota?.connected ?? false,
    codex: connected.codex,
    cursor: connected.cursor,
    grok: connected.grok,
    antigravity: connected.antigravity,
  };

  const activeLoading = activeView === 'all'
    ? claudeLoading || SERVICES.some((svc) => panelLoading[svc])
    : activeProvider === 'claude' ? claudeLoading : panelLoading[activeProvider];

  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !activeLoading) {
      setLastUpdatedAt(Date.now());
    }
    prevLoadingRef.current = activeLoading;
  }, [activeLoading]);

  const serviceUsage: ServiceMap<number | null> = {
    ...usedPercent,
    claude: getClaudeTrayUsedPercent(quota),
  };
  const serviceLoading: ServiceMap<boolean> = {
    ...panelLoading,
    claude: claudeLoading,
  };
  const { footerStatus, footerStatusTitle } = useFooterStatus(windowVisible, activeLoading, lastUpdatedAt);
  const providerSummaries = buildProviderSummaries(tabConnected, serviceLoading, serviceUsage);
  const switcherSummaries = providerSummaries.filter((summary) => switcherVisibility[summary.id]);
  const allQuotaWindows = [
    ...buildClaudeQuotaWindows(quota),
    ...providerQuotaWindows.codex,
    ...providerQuotaWindows.cursor,
    ...providerQuotaWindows.grok,
  ];
  const mostConstrained = sortMostConstrained(allQuotaWindows).slice(0, 4);
  const upcomingResets = sortUpcomingResets(allQuotaWindows).slice(0, 5);
  const providerViewActive = isProviderTab(activeView);
  const overviewCostRefreshKey = claudeCostRefreshNonce + refreshNonces.codex + refreshNonces.cursor;

  return (
    <div className={`app theme-${theme}`}>
      {toast && <div className="toast">{toast}</div>}
      <div className="container" ref={containerRef}>
        {activeView === 'settings' ? (
          <div className="panel-scroll settings-scroll">
            <SettingsView
              isMacOS={isMacOS}
              theme={theme}
              dockHidden={dockHidden}
              trayEntries={trayEntries}
              panelSections={panelSections}
              trayStyle={trayStyle}
              trayCycle={trayCycle}
              events={events}
              notificationSettings={notifSettings}
              switcherVisibility={switcherVisibility}
              onClose={handleCloseSettings}
              onThemeChange={handleThemeChange}
              onDockToggle={handleDockToggle}
              onTrayToggle={handleTrayToggle}
              onPanelSectionToggle={handlePanelSectionToggle}
              onTrayStyleChange={handleTrayStyleChange}
              onTrayCycleToggle={handleTrayCycleToggle}
              onNotificationToggle={handleNotificationToggle}
              onSwitcherToggle={handleSwitcherToggle}
              onApplyPreset={applyProviderPreset}
              onSelectEventProvider={handleSelectEventProvider}
            />
          </div>
        ) : (
          <>
            <div className="command-bar">
              <TabSwitcher
                activeTab={activeTab}
                onTabChange={handleTabChange}
                summaries={switcherSummaries}
              />
            </div>

            <div className="panel-scroll">
              {providerViewActive && activeView === 'claude' && (
                <ClaudePanel
                  quota={quota}
                  loading={claudeLoading}
                  error={claudeError}
                  windowVisible={windowVisible}
                  costRefreshKey={claudeCostRefreshNonce}
                  onRetry={handleRefresh}
                  sections={panelSections}
                />
              )}

              <div style={{ display: activeView === 'codex' ? 'block' : 'none' }}>
                <CodexPanel
                  onConnectionChange={connectionSetters.codex}
                  onUsageChange={usageSetters.codex}
                  onLoadingChange={loadingSetters.codex}
                  onQuotaWindowsChange={quotaWindowSetters.codex}
                  manualRefreshNonce={refreshNonces.codex}
                  autoRefreshIntervalMs={providerRefreshIntervalMs(windowVisible, trayEnabled.codex)}
                  showCostSummary={windowVisible && activeView === 'codex'}
                  sections={panelSections}
                  onBonusExpiring={handleBonusExpiring}
                  onBonusReadyChange={handleBonusReadyChange}
                  onOpenDashboard={handleOpenDashboard}
                />
              </div>

              <div style={{ display: activeView === 'cursor' ? 'block' : 'none' }}>
                <CursorPanel
                  onConnectionChange={connectionSetters.cursor}
                  onUsageChange={usageSetters.cursor}
                  onLoadingChange={loadingSetters.cursor}
                  onQuotaWindowsChange={quotaWindowSetters.cursor}
                  manualRefreshNonce={refreshNonces.cursor}
                  autoRefreshIntervalMs={providerRefreshIntervalMs(windowVisible, trayEnabled.cursor)}
                  showCostSummary={windowVisible && activeView === 'cursor'}
                  sections={panelSections}
                />
              </div>

              <div style={{ display: activeView === 'grok' ? 'block' : 'none' }}>
                <GrokPanel
                  onConnectionChange={connectionSetters.grok}
                  onUsageChange={usageSetters.grok}
                  onLoadingChange={loadingSetters.grok}
                  onQuotaWindowsChange={quotaWindowSetters.grok}
                  manualRefreshNonce={refreshNonces.grok}
                  autoRefreshIntervalMs={providerRefreshIntervalMs(windowVisible, trayEnabled.grok)}
                  sections={panelSections}
                />
              </div>

              <div style={{ display: activeView === 'antigravity' ? 'block' : 'none' }}>
                <AntigravityPanel
                  onConnectionChange={connectionSetters.antigravity}
                  onLoadingChange={loadingSetters.antigravity}
                  manualRefreshNonce={refreshNonces.antigravity}
                />
              </div>

              {activeView === 'all' && (
                <OverviewPanel
                  summaries={providerSummaries}
                  mostConstrained={mostConstrained}
                  upcomingResets={upcomingResets}
                  costRefreshKey={overviewCostRefreshKey} showCostSummary={windowVisible}
                  onProviderSelect={setAndPersistTab}
                  sections={panelSections}
                />
              )}
            </div>

            <ActionButtons
              onRefresh={handleRefresh}
              onDashboard={handleOpenDashboard}
              onSettings={handleSettingsViewToggle}
              onQuit={handleQuit}
              loading={activeLoading}
              statusText={footerStatus}
              statusTitle={footerStatusTitle}
              showDashboard={providerViewActive}
            />
          </>
        )}
      </div>
    </div>
  );
}

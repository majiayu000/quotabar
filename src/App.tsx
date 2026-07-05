import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ActionButtons from './components/ActionButtons';
import QuickActions from './components/QuickActions';
import OverviewPanel from './components/OverviewPanel';
import SettingsView from './components/SettingsView';
import type { ThemeName } from './components/ThemeSelector';
import TabSwitcher, { TabName } from './components/TabSwitcher';
import ClaudePanel from './components/ClaudePanel';
import CodexPanel from './components/CodexPanel';
import CursorPanel from './components/CursorPanel';
import AntigravityPanel from './components/AntigravityPanel';
import type { TrayToggleEntry } from './components/TrayToggles';
import { backend, hasTauriBackend } from './services/backend';
import { SERVICE_META, SERVICES } from './services/service_meta';
import {
  getSavedTrayEnabled,
  saveTrayEnabled,
  shouldShowTray,
  type TrayServiceName,
} from './services/tray_visibility';
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
import { getSavedEvents, recordEvent, type AppEvent, type EventLevel } from './services/event_log';
import {
  getSavedSwitcherVisibility,
  saveSwitcherVisibility,
  type SwitcherVisibility,
} from './services/switcher_providers';
import {
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
import './styles.css';
import './redesign.css';
import './redesign-settings.css';

const THEME_STORAGE_KEY = 'claude-quota-theme';
const DOCK_HIDDEN_KEY = 'claude-quota-dock-hidden';
const TAB_STORAGE_KEY = 'claude-quota-tab';
const SETTINGS_EXPANDED_KEY = 'claude-quota-settings-expanded';
export const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
export const BACKOFF_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const AUTH_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TRAY_SERVICE_ACTIVATED_EVENT = 'tray-service-activated';
const TRAY_GUARD_TOAST_MS = 2000;
const TRAY_CYCLE_INTERVAL_MS = 15 * 1000;
const TRAY_GUARD_MESSAGE = 'At least one tray must remain enabled';
const VALID_TABS = new Set<string>(['all', ...SERVICES]);

interface TrayServiceActivatedPayload {
  service: TrayServiceName;
}

type ServiceMap<T> = Record<TrayServiceName, T>;
type TrayEnabledState = ServiceMap<boolean>;
type TrayIconRequest = {
  percentage: number | null;
  visible: boolean;
  style: TrayStyle;
};

function defaultServiceMap<T>(value: T): ServiceMap<T> {
  return SERVICES.reduce((acc, svc) => {
    acc[svc] = value;
    return acc;
  }, {} as ServiceMap<T>);
}

function isMacOSPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac/i.test(platform);
}

function getSavedTab(): TabName {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (saved && VALID_TABS.has(saved)) {
      return saved as TabName;
    }
  } catch {}
  return 'claude';
}

function getSavedTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && ['light', 'dark', 'claude', 'claude-dark', 'minimal', 'minimal-dark', 'ocean'].includes(saved)) {
      return saved as ThemeName;
    }
  } catch {}
  return 'light';
}

function getSavedDockHidden(): boolean {
  try {
    return localStorage.getItem(DOCK_HIDDEN_KEY) === 'true';
  } catch {}
  return false;
}

function getSavedSettingsExpanded(): boolean {
  try {
    return localStorage.getItem(SETTINGS_EXPANDED_KEY) === 'true';
  } catch {}
  return false;
}

function getInitialTrayEnabledState(): TrayEnabledState {
  const state = defaultServiceMap(false);
  for (const svc of SERVICES) {
    state[svc] = getSavedTrayEnabled(svc);
  }
  if (!SERVICES.some((svc) => state[svc])) {
    saveTrayEnabled('claude', true);
    state.claude = true;
  }
  return state;
}

export function getClaudeTrayUsedPercent(quota: QuotaData | null): number | null {
  if (!quota) return null;

  if (quota.weeklyTotal) {
    return quota.weeklyTotal.percentage;
  }

  const weeklyUsedCandidates = [
    quota.weeklyOpus?.percentage,
    quota.weeklySonnet?.percentage,
    quota.weeklyDesign?.percentage,
    quota.weeklyFable5?.percentage,
  ]
    .filter((value): value is number => typeof value === 'number');
  if (weeklyUsedCandidates.length > 0) {
    return Math.max(...weeklyUsedCandidates);
  }

  if (quota.session) {
    return quota.session.percentage;
  }

  return null;
}

function isClaudeAuthError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes('oauth token') ||
    normalized.includes('re-login') ||
    normalized.includes('login to claude code') ||
    normalized.includes('token expired') ||
    normalized.includes('expired or invalid') ||
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden')
  );
}

export function getClaudeRefreshIntervalMs(error?: string | null): number {
  if (!error) {
    return AUTO_REFRESH_INTERVAL_MS;
  }

  if (error.includes('429')) {
    return BACKOFF_REFRESH_INTERVAL_MS;
  }

  if (isClaudeAuthError(error)) {
    return AUTH_REFRESH_INTERVAL_MS;
  }

  return AUTO_REFRESH_INTERVAL_MS;
}

export default function App() {
  const isMacOS = isMacOSPlatform();

  // Claude state (still owned by App because of adaptive backoff)
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [claudeCostRefreshNonce, setClaudeCostRefreshNonce] = useState(0);
  const claudeIntervalRef = useRef(AUTO_REFRESH_INTERVAL_MS);

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
  const [toast, setToast] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppViewName>(() =>
    getSavedSettingsExpanded() ? 'settings' : getSavedTab(),
  );
  const [lastProviderTab, setLastProviderTab] = useState<TrayServiceName>(() => {
    const saved = getSavedTab();
    return isProviderTab(saved) ? saved : 'claude';
  });
  const [windowVisible, setWindowVisible] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [panelSections, setPanelSections] = useState<PanelSectionVisibility>(getSavedPanelSections);
  const [trayStyle, setTrayStyle] = useState<TrayStyle>(getSavedTrayStyle);
  const [trayCycle, setTrayCycle] = useState<boolean>(getSavedTrayCycle);
  const [trayCycleIndex, setTrayCycleIndex] = useState(0);
  const [events, setEvents] = useState<AppEvent[]>(getSavedEvents);
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(getSavedNotificationSettings);
  const [switcherVisibility, setSwitcherVisibility] = useState<SwitcherVisibility>(getSavedSwitcherVisibility);
  const prevServiceStateRef = useRef<ServiceMap<{ connected: boolean; used: number | null }> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTrayIconRequestRef = useRef<Partial<Record<TrayServiceName, TrayIconRequest>>>({});
  const refreshIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const setAndPersistTab = useCallback((tab: TabName) => {
    setActiveView(tab);
    if (isProviderTab(tab)) {
      setLastProviderTab(tab);
    }
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
      localStorage.setItem(SETTINGS_EXPANDED_KEY, 'false');
    } catch {}
  }, []);

  // Auto-resize window
  useEffect(() => {
    if (!windowVisible) {
      return;
    }

    const updateHeight = async () => {
      if (containerRef.current) {
        const height = containerRef.current.scrollHeight + 24;
        try {
          await backend.resizeWindow(Math.min(Math.max(height, 300), 620));
        } catch (err) {
          console.error('Failed to resize window:', err);
        }
      }
    };

    const timer1 = setTimeout(updateHeight, 50);
    const timer2 = setTimeout(updateHeight, 300);

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      observer.disconnect();
    };
  }, [activeView, quota, connected, windowVisible]);

  useEffect(() => {
    return () => {
      if (refreshIndicatorTimerRef.current) {
        clearTimeout(refreshIndicatorTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      setWindowVisible(true);
      return;
    }

    const appWindow = getCurrentWindow();
    let mounted = true;
    let unlisten: (() => void) | null = null;

    appWindow.isVisible()
      .then((visible) => {
        if (mounted) {
          setWindowVisible(visible);
        }
      })
      .catch(() => {
        if (mounted) {
          setWindowVisible(true);
        }
      });

    appWindow.onFocusChanged(({ payload: focused }) => {
      setWindowVisible(focused);
    })
      .then((stopListening) => {
        if (mounted) {
          unlisten = stopListening;
          return;
        }
        stopListening();
      })
      .catch(() => {
        if (mounted) {
          setWindowVisible(true);
        }
      });

    return () => {
      mounted = false;
      if (unlisten) {
        unlisten();
      }
    };
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
    try {
      setClaudeLoading(true);
      setClaudeError(null);
      const data = await backend.getQuota();

      if (data.error) {
        setClaudeError(data.error);
        if (!data.error.includes('429')) {
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
      const message = err instanceof Error ? err.message : 'Unknown error';
      setClaudeError(message);
      claudeIntervalRef.current = getClaudeRefreshIntervalMs(message);
      setServiceConnected('claude', false);
    } finally {
      setClaudeLoading(false);
    }
  }, [setServiceConnected]);

  useEffect(() => {
    if (pollingPaused) return;

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
  }, [fetchClaudeQuota, pollingPaused]);

  useEffect(() => {
    setServiceUsedPercent('claude', getClaudeTrayUsedPercent(quota));
  }, [quota, setServiceUsedPercent]);

  const syncTrayIcons = useCallback((force = false) => {
    const candidates = SERVICES.filter((svc) => {
      const isConnected = svc === 'claude' ? quota?.connected ?? false : connected[svc];
      return shouldShowTray(trayEnabled[svc], isConnected);
    });
    // Cycle mode keeps a single menu bar item, rotating through the candidates.
    const cycled = trayCycle && candidates.length > 1
      ? candidates[trayCycleIndex % candidates.length]
      : null;

    for (const svc of SERVICES) {
      const pct = svc === 'claude' ? getClaudeTrayUsedPercent(quota) : usedPercent[svc];
      const showable = candidates.includes(svc);
      const visible = cycled ? svc === cycled : showable;
      updateTrayIcon(svc, pct, visible, force, trayStyle);
    }
  }, [quota, connected, usedPercent, trayEnabled, trayCycle, trayCycleIndex, trayStyle, updateTrayIcon]);

  useEffect(() => {
    syncTrayIcons();
  }, [syncTrayIcons]);

  useEffect(() => {
    const interval = setInterval(() => {
      syncTrayIcons(true);
    }, 5000);
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
    setEvents((prev) => recordEvent(prev, level, text));
  }, []);

  // Detect provider connectivity and usage-threshold transitions.
  useEffect(() => {
    const current = SERVICES.reduce((acc, svc) => {
      acc[svc] = {
        connected: svc === 'claude' ? quota?.connected ?? false : connected[svc],
        used: svc === 'claude' ? getClaudeTrayUsedPercent(quota) : usedPercent[svc],
      };
      return acc;
    }, {} as ServiceMap<{ connected: boolean; used: number | null }>);

    const prev = prevServiceStateRef.current;
    prevServiceStateRef.current = current;
    if (!prev) return;

    for (const svc of SERVICES) {
      const label = SERVICE_META[svc].label;
      const before = prev[svc];
      const after = current[svc];

      if (before.connected !== after.connected) {
        logEvent(
          after.connected ? 'info' : 'warning',
          `${label} ${after.connected ? 'connected' : 'disconnected'}`,
        );
      }

      if (before.used != null && after.used != null) {
        if (before.used < 95 && after.used >= 95) {
          logEvent('critical', `${label} usage crossed 95%`);
          if (notifSettings.q95) {
            void notify('QuotaBar', `${label} usage crossed 95%`);
          }
        } else if (before.used < 80 && after.used >= 80) {
          logEvent('warning', `${label} usage crossed 80%`);
          if (notifSettings.q80) {
            void notify('QuotaBar', `${label} usage crossed 80%`);
          }
        }
      }
    }
  }, [quota, connected, usedPercent, logEvent, notifSettings.q80, notifSettings.q95]);

  const handleSwitcherToggle = useCallback((service: TrayServiceName) => {
    let blocked = false;
    setSwitcherVisibility((prev) => {
      const nextValue = !prev[service];
      if (!nextValue && !SERVICES.some((other) => other !== service && prev[other])) {
        blocked = true;
        return prev;
      }
      const next = { ...prev, [service]: nextValue };
      saveSwitcherVisibility(next);
      return next;
    });
    if (blocked) {
      setToast('At least one provider must stay in the switcher');
      setTimeout(() => setToast(null), TRAY_GUARD_TOAST_MS);
    }
  }, []);

  // If the active provider tab gets hidden from the switcher, fall back to Overview.
  useEffect(() => {
    if (isProviderTab(activeView) && !switcherVisibility[activeView]) {
      setAndPersistTab('all');
    }
  }, [activeView, switcherVisibility, setAndPersistTab]);

  const handleNotificationToggle = useCallback((key: NotificationKey) => {
    setNotifSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveNotificationSettings(next);
      return next;
    });
  }, []);

  const handleBonusExpiring = useCallback((daysLeft: number) => {
    const text = daysLeft <= 0
      ? 'Codex bonus reset expires today'
      : `Codex bonus reset expires in ${daysLeft}d`;
    logEvent('warning', text);
    if (notifSettings.bonus) {
      void notify('QuotaBar', text);
    }
  }, [logEvent, notifSettings.bonus]);

  const handleTrayStyleChange = useCallback((style: TrayStyle) => {
    saveTrayStyle(style);
    setTrayStyle(style);
  }, []);

  const handleTrayCycleToggle = useCallback(() => {
    setTrayCycle((prev) => {
      const next = !prev;
      saveTrayCycle(next);
      return next;
    });
    setTrayCycleIndex(0);
  }, []);

  const handleThemeChange = useCallback((newTheme: ThemeName) => {
    setTheme(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {}
  }, []);

  useEffect(() => {
    backend.setDockVisibility(!dockHidden).catch((err) => {
      console.error('Failed to apply dock visibility:', err);
    });
  }, [dockHidden]);

  const handleDockToggle = useCallback(() => {
    setDockHidden((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem(DOCK_HIDDEN_KEY, String(newValue));
      } catch {}
      return newValue;
    });
  }, []);

  const showTrayGuardToast = useCallback(() => {
    setToast(TRAY_GUARD_MESSAGE);
    setTimeout(() => setToast(null), TRAY_GUARD_TOAST_MS);
  }, []);

  const handleTrayToggle = useCallback((service: TrayServiceName) => {
    let blocked = false;

    setTrayEnabled((prev) => {
      const nextValue = !prev[service];
      const someOtherEnabled = SERVICES.some((other) => other !== service && prev[other]);

      if (!nextValue && !someOtherEnabled) {
        blocked = true;
        return prev;
      }

      saveTrayEnabled(service, nextValue);
      return {
        ...prev,
        [service]: nextValue,
      };
    });

    if (blocked) {
      showTrayGuardToast();
    }
  }, [showTrayGuardToast]);

  const handlePanelSectionToggle = useCallback((key: PanelSectionKey) => {
    setPanelSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      savePanelSections(next);
      return next;
    });
  }, []);

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
    setJustRefreshed(true);
    if (refreshIndicatorTimerRef.current) {
      clearTimeout(refreshIndicatorTimerRef.current);
    }
    refreshIndicatorTimerRef.current = setTimeout(() => setJustRefreshed(false), 2000);

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
        case 'antigravity':
          await backend.openAntigravityDashboard();
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open dashboard';
      setToast(message);
      setTimeout(() => setToast(null), 2000);
    }
  }, [activeProvider]);

  const handleSettingsViewToggle = useCallback(() => {
    setActiveView((prev) => {
      const opening = prev !== 'settings';
      try {
        localStorage.setItem(SETTINGS_EXPANDED_KEY, String(opening));
      } catch {}
      return opening ? 'settings' : getSavedTab();
    });
  }, []);

  const handleCloseSettings = useCallback(() => {
    try {
      localStorage.setItem(SETTINGS_EXPANDED_KEY, 'false');
    } catch {}
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
    antigravity: connected.antigravity,
  };

  const activeLoading = activeView === 'all'
    ? claudeLoading || SERVICES.some((svc) => panelLoading[svc])
    : activeProvider === 'claude' ? claudeLoading : panelLoading[activeProvider];

  const serviceUsage: ServiceMap<number | null> = {
    ...usedPercent,
    claude: getClaudeTrayUsedPercent(quota),
  };
  const serviceLoading: ServiceMap<boolean> = {
    ...panelLoading,
    claude: claudeLoading,
  };
  const nonClaudeRefreshIntervalMs = pollingPaused
    ? 0
    : windowVisible
      ? AUTO_REFRESH_INTERVAL_MS
      : BACKGROUND_REFRESH_INTERVAL_MS;
  // Keep this short: the footer status slot is ~80px wide.
  const footerStatus = activeLoading
    ? 'Updating...'
    : justRefreshed
      ? 'Updated now'
      : `Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const providerSummaries = buildProviderSummaries(tabConnected, serviceLoading, serviceUsage);
  const switcherSummaries = providerSummaries.filter((summary) => switcherVisibility[summary.id]);
  const usageParts = providerSummaries
    .filter((summary) => summary.usedPercent != null)
    .map((summary) => `${summary.label} ${Math.round(summary.usedPercent as number)}%`);
  const statusCopyText = usageParts.length > 0
    ? `${usageParts.join(' · ')} — via QuotaBar`
    : 'No usage data yet — via QuotaBar';
  const allQuotaWindows = [
    ...buildClaudeQuotaWindows(quota),
    ...providerQuotaWindows.codex,
    ...providerQuotaWindows.cursor,
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
                  autoRefreshIntervalMs={nonClaudeRefreshIntervalMs}
                  showCostSummary={windowVisible && activeView === 'codex'}
                  sections={panelSections}
                  onBonusExpiring={handleBonusExpiring}
                />
              </div>

              <div style={{ display: activeView === 'cursor' ? 'block' : 'none' }}>
                <CursorPanel
                  onConnectionChange={connectionSetters.cursor}
                  onUsageChange={usageSetters.cursor}
                  onLoadingChange={loadingSetters.cursor}
                  onQuotaWindowsChange={quotaWindowSetters.cursor}
                  manualRefreshNonce={refreshNonces.cursor}
                  autoRefreshIntervalMs={nonClaudeRefreshIntervalMs}
                  showCostSummary={windowVisible && activeView === 'cursor'}
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
                  costRefreshKey={overviewCostRefreshKey}
                  onProviderSelect={setAndPersistTab}
                  sections={panelSections}
                />
              )}
            </div>

            {panelSections.quick && (
            <QuickActions
              statusText={statusCopyText}
              paused={pollingPaused}
              onTogglePause={() => setPollingPaused((prev) => !prev)}
              onOpenUsagePage={handleOpenDashboard}
            />
            )}

            <ActionButtons
              onRefresh={handleRefresh}
              onDashboard={handleOpenDashboard}
              onSettings={handleSettingsViewToggle}
              onQuit={handleQuit}
              loading={activeLoading}
              statusText={footerStatus}
            />
          </>
        )}
      </div>
    </div>
  );
}

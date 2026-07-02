import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ActionButtons from './components/ActionButtons';
import ThemeSelector, { ThemeName } from './components/ThemeSelector';
import TabSwitcher, { TabName } from './components/TabSwitcher';
import ClaudePanel from './components/ClaudePanel';
import CodexPanel from './components/CodexPanel';
import CursorPanel from './components/CursorPanel';
import AntigravityPanel from './components/AntigravityPanel';
import TrayToggles, { type TrayToggleEntry } from './components/TrayToggles';
import { backend, hasTauriBackend } from './services/backend';
import { SERVICE_META, SERVICES } from './services/service_meta';
import {
  getSavedTrayEnabled,
  saveTrayEnabled,
  shouldShowTray,
  type TrayServiceName,
} from './services/tray_visibility';
import type { QuotaData } from './types/models';
import './styles.css';

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
const TRAY_GUARD_MESSAGE = 'At least one tray must remain enabled';
const VALID_TABS = new Set<string>(SERVICES);

const THEME_LABELS: Record<ThemeName, string> = {
  light: 'Light',
  dark: 'Dark',
  claude: 'Claude',
  'claude-dark': 'Claude Dark',
  minimal: 'Minimal',
  'minimal-dark': 'Minimal Dark',
  ocean: 'Ocean',
};

interface TrayServiceActivatedPayload {
  service: TrayServiceName;
}

type ServiceMap<T> = Record<TrayServiceName, T>;
type TrayEnabledState = ServiceMap<boolean>;
type TrayIconRequest = {
  percentage: number | null;
  visible: boolean;
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

  // Manual refresh nonces (per non-Claude service)
  const [refreshNonces, setRefreshNonces] = useState<ServiceMap<number>>(() => defaultServiceMap(0));

  // UI state
  const [theme, setTheme] = useState<ThemeName>(getSavedTheme);
  const [dockHidden, setDockHidden] = useState<boolean>(getSavedDockHidden);
  const [trayEnabled, setTrayEnabled] = useState<TrayEnabledState>(getInitialTrayEnabledState);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>(getSavedTab);
  const [windowVisible, setWindowVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
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

  const setAndPersistTab = useCallback((tab: TabName) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
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
          await backend.resizeWindow(Math.min(Math.max(height, 300), 600));
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
  }, [activeTab, quota, connected, windowVisible]);

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
  ) => {
    const previous = lastTrayIconRequestRef.current[service];
    if (previous?.percentage === percentage && previous.visible === visible) {
      return;
    }

    try {
      await backend.updateTrayIcon(service, percentage, visible);
      lastTrayIconRequestRef.current[service] = { percentage, visible };
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

  const syncTrayIcons = useCallback(() => {
    for (const svc of SERVICES) {
      const pct = svc === 'claude' ? getClaudeTrayUsedPercent(quota) : usedPercent[svc];
      const isConnected = svc === 'claude' ? quota?.connected ?? false : connected[svc];
      updateTrayIcon(svc, pct, shouldShowTray(trayEnabled[svc], isConnected));
    }
  }, [quota, connected, usedPercent, trayEnabled, updateTrayIcon]);

  useEffect(() => {
    syncTrayIcons();
  }, [syncTrayIcons]);

  useEffect(() => {
    const interval = setInterval(() => {
      syncTrayIcons();
    }, 5000);
    return () => clearInterval(interval);
  }, [syncTrayIcons]);

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

  const handleRefresh = useCallback(() => {
    if (activeTab === 'claude') {
      fetchClaudeQuota();
      setClaudeCostRefreshNonce((value) => value + 1);
      return;
    }
    setRefreshNonces((prev) => ({ ...prev, [activeTab]: prev[activeTab] + 1 }));
  }, [activeTab, fetchClaudeQuota]);

  const handleOpenDashboard = useCallback(async () => {
    try {
      switch (activeTab) {
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
  }, [activeTab]);

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

  const tabConnected: Record<TabName, boolean> = {
    claude: quota?.connected ?? false,
    codex: connected.codex,
    cursor: connected.cursor,
    antigravity: connected.antigravity,
  };

  const activeLoading =
    activeTab === 'claude' ? claudeLoading : panelLoading[activeTab];

  const serviceUsage: ServiceMap<number | null> = {
    ...usedPercent,
    claude: getClaudeTrayUsedPercent(quota),
  };
  const serviceLoading: ServiceMap<boolean> = {
    ...panelLoading,
    claude: claudeLoading,
  };
  const nonClaudeRefreshIntervalMs = windowVisible
    ? AUTO_REFRESH_INTERVAL_MS
    : BACKGROUND_REFRESH_INTERVAL_MS;
  const enabledTrayCount = SERVICES.filter((svc) => trayEnabled[svc]).length;
  const connectedTrayCount = trayEntries.filter((entry) => entry.connected).length;
  const settingsSummary = `${THEME_LABELS[theme]} / ${enabledTrayCount} tray on / ${connectedTrayCount} connected`;
  return (
    <div className={`app theme-${theme}`}>
      {toast && <div className="toast">{toast}</div>}
      <div className="container" ref={containerRef}>
        <div className="panel-scroll">
          {activeTab === 'claude' && (
            <ClaudePanel
              quota={quota}
              loading={claudeLoading}
              error={claudeError}
              windowVisible={windowVisible}
              costRefreshKey={claudeCostRefreshNonce}
              onRetry={handleRefresh}
            />
          )}

          <div style={{ display: activeTab === 'codex' ? 'block' : 'none' }}>
            <CodexPanel
              onConnectionChange={connectionSetters.codex}
              onUsageChange={usageSetters.codex}
              onLoadingChange={loadingSetters.codex}
              manualRefreshNonce={refreshNonces.codex}
              autoRefreshIntervalMs={nonClaudeRefreshIntervalMs}
              showCostSummary={windowVisible && activeTab === 'codex'}
            />
          </div>

          <div style={{ display: activeTab === 'cursor' ? 'block' : 'none' }}>
            <CursorPanel
              onConnectionChange={connectionSetters.cursor}
              onUsageChange={usageSetters.cursor}
              onLoadingChange={loadingSetters.cursor}
              manualRefreshNonce={refreshNonces.cursor}
              autoRefreshIntervalMs={nonClaudeRefreshIntervalMs}
              showCostSummary={windowVisible && activeTab === 'cursor'}
            />
          </div>

          <div style={{ display: activeTab === 'antigravity' ? 'block' : 'none' }}>
            <AntigravityPanel
              onConnectionChange={connectionSetters.antigravity}
              onLoadingChange={loadingSetters.antigravity}
              manualRefreshNonce={refreshNonces.antigravity}
            />
          </div>
          <div className="bottom-controls">
            <div className="command-bar">
              <TabSwitcher
                activeTab={activeTab}
                onTabChange={handleTabChange}
                connected={tabConnected}
                loading={serviceLoading}
                usedPercent={serviceUsage}
              />
            </div>

            <div className="settings-row" aria-label="Settings">
              <input
                id="settings-fold-toggle"
                className="settings-fold-input"
                type="checkbox"
                defaultChecked={getSavedSettingsExpanded()}
                onChange={(event) => {
                  try {
                    localStorage.setItem(SETTINGS_EXPANDED_KEY, String(event.currentTarget.checked));
                  } catch {}
                }}
              />
              <label
                htmlFor="settings-fold-toggle"
                className="settings-fold-header"
              >
                <span className="settings-fold-copy">
                  <span className="settings-title">Settings</span>
                  <span className="settings-summary">{settingsSummary}</span>
                </span>
                <span className="settings-chevron" aria-hidden="true" />
              </label>

              <div
                id="settings-fold-body"
                className="settings-fold-body"
              >
                <div className="settings-fold-content">
                  <div className="settings-meta">
                    <span className="settings-title">Appearance</span>
                    {isMacOS && (
                      <label className="dock-toggle">
                        <span className="toggle-label">Hide Dock</span>
                        <input
                          type="checkbox"
                          checked={dockHidden}
                          onChange={handleDockToggle}
                        />
                      </label>
                    )}
                  </div>
                  <ThemeSelector currentTheme={theme} onThemeChange={handleThemeChange} />
                  <TrayToggles entries={trayEntries} onToggle={handleTrayToggle} />
                </div>
              </div>
            </div>

            <ActionButtons
              onRefresh={handleRefresh}
              onDashboard={handleOpenDashboard}
              onQuit={handleQuit}
              loading={activeLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

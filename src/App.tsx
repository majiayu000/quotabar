import { useEffect, useState, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import QuotaCard from './components/QuotaCard';
import ActionButtons from './components/ActionButtons';
import ThemeSelector, { ThemeName } from './components/ThemeSelector';
import TabSwitcher, { TabName } from './components/TabSwitcher';
import CodexPanel from './components/CodexPanel';
import TrayToggles from './components/TrayToggles';
import CostSummarySection from './components/CostSummarySection';
import { backend } from './services/backend';
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
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
const BACKOFF_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TRAY_SERVICE_ACTIVATED_EVENT = 'tray-service-activated';
const TRAY_GUARD_TOAST_MS = 2000;
const TRAY_GUARD_MESSAGE = 'At least one tray must remain enabled';

interface TrayServiceActivatedPayload {
  service: TrayServiceName;
}

type TrayEnabledState = Record<TrayServiceName, boolean>;

function isMacOSPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac/i.test(platform);
}

function getSavedTab(): TabName {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (saved === 'claude' || saved === 'codex') {
      return saved;
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

function getInitialTrayEnabledState(): TrayEnabledState {
  const claude = getSavedTrayEnabled('claude');
  const codex = getSavedTrayEnabled('codex');

  if (!claude && !codex) {
    saveTrayEnabled('claude', true);
    saveTrayEnabled('codex', false);
    return { claude: true, codex: false };
  }

  return { claude, codex };
}

function formatResetTime(resetTime?: string): string {
  if (!resetTime) return 'N/A';
  try {
    const reset = new Date(resetTime);
    const now = new Date();
    const diff = reset.getTime() - now.getTime();
    if (diff <= 0) return 'Soon';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  } catch {
    return 'N/A';
  }
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

export default function App() {
  const isMacOS = isMacOSPlatform();

  // Claude state
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [claudeCostRefreshNonce, setClaudeCostRefreshNonce] = useState(0);
  const claudeIntervalRef = useRef(AUTO_REFRESH_INTERVAL_MS);

  // Codex state
  const [codexConnected, setCodexConnected] = useState(false);
  const [codexUsedPercent, setCodexUsedPercent] = useState<number | null>(null);
  const [codexLoading, setCodexLoading] = useState(false);
  const [codexManualRefreshNonce, setCodexManualRefreshNonce] = useState(0);

  // UI state
  const [theme, setTheme] = useState<ThemeName>(getSavedTheme);
  const [dockHidden, setDockHidden] = useState<boolean>(getSavedDockHidden);
  const [trayEnabled, setTrayEnabled] = useState<TrayEnabledState>(getInitialTrayEnabledState);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>(getSavedTab);
  const containerRef = useRef<HTMLDivElement>(null);
  const claudeTrayEnabled = trayEnabled.claude;
  const codexTrayEnabled = trayEnabled.codex;

  const setAndPersistTab = useCallback((tab: TabName) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {}
  }, []);

  // Auto-resize window
  useEffect(() => {
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
  }, [activeTab, quota, codexConnected]);

  const updateTrayIcon = useCallback(async (
    service: TrayServiceName,
    percentage: number | null,
    visible: boolean,
  ) => {
    try {
      await backend.updateTrayIcon(service, percentage, visible);
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
        // On 429, keep showing stale quota data if we have it
        if (!data.error.includes('429')) {
          setQuota(null);
        }
        // Back off polling on 429
        if (data.error.includes('429')) {
          claudeIntervalRef.current = BACKOFF_REFRESH_INTERVAL_MS;
        }
      } else {
        setQuota(data);
        setClaudeError(null);
        // Reset to normal interval on success
        claudeIntervalRef.current = AUTO_REFRESH_INTERVAL_MS;
      }
    } catch (err) {
      setClaudeError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setClaudeLoading(false);
    }
  }, []);

  // Load Claude data on startup.
  useEffect(() => {
    fetchClaudeQuota();
  }, [fetchClaudeQuota]);

  // Auto-refresh Claude data in background with adaptive interval.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        fetchClaudeQuota().then(schedule);
      }, claudeIntervalRef.current);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [fetchClaudeQuota]);

  const syncTrayIcons = useCallback(() => {
    updateTrayIcon(
      'claude',
      getClaudeTrayUsedPercent(quota),
      shouldShowTray(claudeTrayEnabled, quota?.connected ?? false),
    );
    updateTrayIcon(
      'codex',
      codexUsedPercent,
      shouldShowTray(codexTrayEnabled, codexConnected),
    );
  }, [
    quota,
    claudeTrayEnabled,
    codexUsedPercent,
    codexConnected,
    codexTrayEnabled,
    updateTrayIcon,
  ]);

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

  // Apply dock visibility from current toggle state on startup and on changes.
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
      const otherService: TrayServiceName = service === 'claude' ? 'codex' : 'claude';

      if (!nextValue && !prev[otherService]) {
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
    let unlisten: (() => void) | null = null;
    let mounted = true;

    listen<TrayServiceActivatedPayload>(TRAY_SERVICE_ACTIVATED_EVENT, (event) => {
      const service = event.payload?.service;
      if (service === 'claude' || service === 'codex') {
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
    setCodexManualRefreshNonce((value) => value + 1);
  }, [activeTab, fetchClaudeQuota]);

  const handleOpenDashboard = useCallback(async () => {
    try {
      if (activeTab === 'claude') {
        await backend.openClaudeDashboard();
      } else {
        await backend.openCodexDashboard();
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

  // Callback from CodexPanel to update usage percentage for tray icon
  const handleCodexUsageChange = useCallback((usedPercent: number | null) => {
    setCodexUsedPercent(usedPercent);
  }, []);

  return (
    <div className={`app theme-${theme}`}>
      {toast && <div className="toast">{toast}</div>}
      <div className="container" ref={containerRef}>
        <TabSwitcher
          activeTab={activeTab}
          onTabChange={handleTabChange}
          claudeConnected={quota?.connected ?? false}
          codexConnected={codexConnected}
        />

        <div className="settings-row">
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
          <TrayToggles
            claudeEnabled={claudeTrayEnabled}
            codexEnabled={codexTrayEnabled}
            claudeCanDisable={codexTrayEnabled}
            codexCanDisable={claudeTrayEnabled}
            claudeConnected={quota?.connected ?? false}
            codexConnected={codexConnected}
            onToggle={handleTrayToggle}
          />
        </div>

        {activeTab === 'claude' && (
          <>
            {claudeLoading && !quota && (
              <div className="loading-state">Loading Claude quota...</div>
            )}

            {claudeError && (
              <div className="error-banner">
                <span className="error-icon">!</span>
                <span className="error-text">{claudeError}</span>
              </div>
            )}

            {!claudeError && quota && (
              <div className="quota-list">
                <div className="section">
                  <div className="section-title">CURRENT SESSION</div>
                  {quota.session ? (
                    <QuotaCard
                      label="5-Hour Usage"
                      percentage={Math.round(quota.session.percentage)}
                      resetsIn={formatResetTime(quota.session.resetTime)}
                    />
                  ) : (
                    <div className="no-data">No session data</div>
                  )}
                </div>

                <div className="section">
                  <div className="section-title">WEEKLY LIMITS</div>

                  {quota.weeklyTotal && (
                    <QuotaCard
                      label="7-Day Usage"
                      percentage={Math.round(quota.weeklyTotal.percentage)}
                      resetsIn={formatResetTime(quota.weeklyTotal.resetTime)}
                    />
                  )}

                  {quota.weeklyOpus && (
                    <QuotaCard
                      label="Opus (7-Day)"
                      percentage={Math.round(quota.weeklyOpus.percentage)}
                      resetsIn={formatResetTime(quota.weeklyOpus.resetTime)}
                    />
                  )}

                  {quota.weeklySonnet && (
                    <QuotaCard
                      label="Sonnet (7-Day)"
                      percentage={Math.round(quota.weeklySonnet.percentage)}
                      resetsIn={formatResetTime(quota.weeklySonnet.resetTime)}
                    />
                  )}

                  {quota.weeklyDesign && (
                    <QuotaCard
                      label="Claude Design (7-Day)"
                      percentage={Math.round(quota.weeklyDesign.percentage)}
                      resetsIn={formatResetTime(quota.weeklyDesign.resetTime)}
                    />
                  )}

                  {!quota.weeklyTotal && !quota.weeklyOpus && !quota.weeklySonnet && !quota.weeklyDesign && (
                    <div className="no-data">No weekly data</div>
                  )}
                </div>

                <CostSummarySection source="claude" refreshKey={claudeCostRefreshNonce} />
              </div>
            )}

            {!claudeError && !quota && !claudeLoading && (
              <div className="empty-state">
                <p>Unable to load quota data</p>
                <button onClick={handleRefresh} className="retry-btn">
                  Try Again
                </button>
              </div>
            )}
          </>
        )}

        <div style={{ display: activeTab === 'codex' ? 'block' : 'none' }}>
          <CodexPanel
            onConnectionChange={setCodexConnected}
            onUsageChange={handleCodexUsageChange}
            onLoadingChange={setCodexLoading}
            manualRefreshNonce={codexManualRefreshNonce}
            autoRefreshIntervalMs={AUTO_REFRESH_INTERVAL_MS}
          />
        </div>

        <ActionButtons
          onRefresh={handleRefresh}
          onDashboard={handleOpenDashboard}
          onQuit={handleQuit}
          loading={activeTab === 'claude' ? claudeLoading : codexLoading}
        />
      </div>
    </div>
  );
}

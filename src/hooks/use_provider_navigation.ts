import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import { backend, hasTauriBackend } from '../services/backend';
import { isProviderTab, type AppTabName, type AppViewName } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';
import { getSavedTab, saveSettingsExpanded, TRAY_SERVICE_ACTIVATED_EVENT, VALID_TABS, type TrayServiceActivatedPayload } from '../services/app_state';

/** Window navigation and native actions shared by the tray and workspace. */
export function useProviderNavigation(
  activeView: AppViewName,
  lastProviderTab: TrayServiceName,
  handleTabChange: (tab: AppTabName) => void,
  setActiveView: Dispatch<SetStateAction<AppViewName>>,
  workspace: boolean,
  showTimedToast: (message: string) => void,
) {
  useEffect(() => {
    if (!hasTauriBackend() || workspace) return;
    let unlisten: (() => void) | null = null;
    let mounted = true;

    listen<TrayServiceActivatedPayload>(TRAY_SERVICE_ACTIVATED_EVENT, (event) => {
      const service = event.payload?.service;
      if (service && VALID_TABS.has(service)) {
        handleTabChange(service);
      }
    })
      .then((stopListening) => {
        if (mounted) {
          unlisten = stopListening;
          return;
        }
        stopListening();
      })
      .catch(() => {
        if (mounted) showTimedToast('无法监听菜单栏切换，请重启 QuotaBar。');
      });

    return () => {
      mounted = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleTabChange, workspace, showTimedToast]);

  const activeProvider = isProviderTab(activeView) ? activeView : lastProviderTab;
  const activeTab: AppTabName = activeView === 'all' ? 'all' : activeProvider;

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
    } catch {
      showTimedToast('退出 QuotaBar 失败，请重试。');
    }
  };

  return { activeProvider, activeTab, handleOpenDashboard, handleSettingsViewToggle, handleCloseSettings, handleQuit };
}

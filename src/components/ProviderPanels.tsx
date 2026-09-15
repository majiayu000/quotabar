import type { ComponentProps } from 'react';
import CodexPanel from './CodexPanel';
import CursorPanel from './CursorPanel';
import GrokPanel from './GrokPanel';
import AntigravityPanel from './AntigravityPanel';
import { AUTO_REFRESH_INTERVAL_MS, providerRefreshIntervalMs, type ServiceMap, type TrayEnabledState } from '../services/app_state';
import type { AppViewName, QuotaWindowSummary } from '../services/provider_summary';
import type { PanelSectionVisibility } from '../services/panel_sections';

/** Keep polling owners mounted while navigating between the overview and details. */
export default function ProviderPanels({
  activeView, workspace, windowVisible, trayEnabled, refreshNonces, sections,
  connectionSetters, usageSetters, loadingSetters, quotaWindowSetters, readResultSetters,
  onBonusExpiring, onBonusReadyChange, onOpenDashboard,
}: {
  activeView: AppViewName;
  workspace: boolean;
  windowVisible: boolean;
  trayEnabled: TrayEnabledState;
  refreshNonces: ServiceMap<number>;
  sections: PanelSectionVisibility;
  connectionSetters: ServiceMap<(value: boolean) => void>;
  usageSetters: ServiceMap<(value: number | null) => void>;
  loadingSetters: ServiceMap<(value: boolean) => void>;
  quotaWindowSetters: ServiceMap<(value: QuotaWindowSummary[]) => void>;
  readResultSetters: ServiceMap<(error: string | null, retryAt?: number | null) => void>;
  onBonusExpiring: ComponentProps<typeof CodexPanel>['onBonusExpiring'];
  onBonusReadyChange: ComponentProps<typeof CodexPanel>['onBonusReadyChange'];
  onOpenDashboard: () => void;
}) {
  function props(service: 'codex' | 'cursor' | 'grok') {
    return {
      onConnectionChange: connectionSetters[service],
      onUsageChange: usageSetters[service],
      onLoadingChange: loadingSetters[service],
      onQuotaWindowsChange: quotaWindowSetters[service],
      onReadResult: readResultSetters[service],
      manualRefreshNonce: refreshNonces[service],
      autoRefreshIntervalMs: workspace ? windowVisible ? AUTO_REFRESH_INTERVAL_MS : 0 : providerRefreshIntervalMs(windowVisible, trayEnabled[service]),
      sections,
    };
  }
  return <>
    <div style={{ display: activeView === 'codex' ? 'block' : 'none' }}>
      <CodexPanel {...props('codex')} showCostSummary={windowVisible && activeView === 'codex'}
        onBonusExpiring={workspace ? undefined : onBonusExpiring}
        onBonusReadyChange={workspace ? undefined : onBonusReadyChange} onOpenDashboard={onOpenDashboard} />
    </div>
    <div style={{ display: activeView === 'cursor' ? 'block' : 'none' }}>
      <CursorPanel {...props('cursor')} showCostSummary={windowVisible && activeView === 'cursor'} />
    </div>
    <div style={{ display: activeView === 'grok' ? 'block' : 'none' }}>
      <GrokPanel {...props('grok')} workspace={workspace} />
    </div>
    <div style={{ display: activeView === 'antigravity' ? 'block' : 'none' }}>
      <AntigravityPanel autoRefreshIntervalMs={workspace ? windowVisible ? AUTO_REFRESH_INTERVAL_MS : 0 : AUTO_REFRESH_INTERVAL_MS}
        onConnectionChange={connectionSetters.antigravity} onLoadingChange={loadingSetters.antigravity}
        manualRefreshNonce={refreshNonces.antigravity} />
    </div>
  </>;
}

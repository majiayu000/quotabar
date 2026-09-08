import type { AppTabName, ProviderSummary } from '../services/provider_summary';
import ProviderIcon from './ProviderIcon';

export type TabName = AppTabName;

interface TabSwitcherProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  summaries: ProviderSummary[];
}

export default function TabSwitcher({
  activeTab,
  onTabChange,
  summaries,
}: TabSwitcherProps) {
  const connectedCount = summaries.filter((summary) => summary.connected).length;
  const attentionCount = summaries.filter((summary) => summary.failed || (summary.usedPercent ?? 0) >= 80).length;
  const overviewStatus = `${connectedCount} connected${attentionCount ? ` · ${attentionCount} need attention` : ''}`;
  return (
    <nav className="provider-grid" aria-label="Provider views">
      {[
        {
          id: 'all' as const,
          label: 'Overview',
          shortLabel: 'All',
          accent: '#0A84FF',
          connected: summaries.some((summary) => summary.connected),
          usedPercent: null,
          usageLabel: undefined,
          failed: false,
          statusText: overviewStatus,
        },
        ...summaries,
      ].map((summary) => {
        const isActive = activeTab === summary.id;
        const usageLabel = summary.id === 'all' ? `${connectedCount} connected` : summary.usedPercent == null ? '—' : `${Math.round(summary.usedPercent)}% used`;
        const statusText = [summary.failed ? 'Stale or unavailable' : summary.statusText, summary.usageLabel].filter(Boolean).join(' · ');

        return (
          <button
            key={summary.id}
            type="button"
            className={`provider-card ${isActive ? 'active' : ''} ${summary.connected ? 'connected' : 'disconnected'}`}
            data-provider={summary.id}
            aria-current={isActive ? 'page' : undefined}
            aria-label={`${summary.label}: ${statusText}`}
            title={`${summary.label} · ${statusText}`}
            onClick={() => onTabChange(summary.id)}
          >
            <span className="provider-card-topline">
              <span className="provider-card-icon" aria-hidden="true">
              {summary.id === 'all' ? (
                <svg className="provider-card-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 3h8v8H3Zm10 0h8v8h-8ZM3 13h8v8H3Zm10 0h8v8h-8Z" />
                </svg>
              ) : (
                <ProviderIcon service={summary.id} className="provider-card-svg" />
              )}
              </span>
              <span className="provider-card-status" aria-hidden="true" />
            </span>
            <span className="provider-card-label">{summary.shortLabel}</span>
            <span className="provider-card-percent">{usageLabel}</span>
            <span className="provider-card-window">{summary.id === 'all' ? attentionCount ? `${attentionCount} need attention` : 'Services' : summary.failed ? 'Check connection' : summary.usageLabel ?? 'Quota window unavailable'}</span>
          </button>
        );
      })}
    </nav>
  );
}

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
  return (
    <nav className="provider-grid" aria-label="Provider views">
      {[
        {
          id: 'all' as const,
          label: 'Overview',
          shortLabel: '总览',
          accent: '#0A84FF',
          connected: summaries.some((summary) => summary.connected),
          usedPercent: null,
        },
        ...summaries,
      ].map((summary) => {
        const isActive = activeTab === summary.id;
        const usageLabel = summary.id === 'all' ? '全部服务' : summary.usedPercent == null ? '—' : `${Math.round(summary.usedPercent)}%`;
        const quotaLabel = summary.usedPercent == null ? usageLabel : `${usageLabel} 已用${'usageLabel' in summary && summary.usageLabel ? ` · ${summary.usageLabel}` : ''}`;
        const statusText = 'statusText' in summary
          ? summary.statusText
          : summary.connected ? 'Providers connected' : 'No providers connected';

        return (
          <button
            key={summary.id}
            type="button"
            className={`provider-card ${isActive ? 'active' : ''} ${summary.connected ? 'connected' : 'disconnected'}`}
            data-provider={summary.id}
            aria-current={isActive ? 'page' : undefined}
            aria-label={`${summary.label}: ${quotaLabel} · ${statusText}`}
            title={`${summary.label} · ${quotaLabel} · ${statusText}`}
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
          </button>
        );
      })}
    </nav>
  );
}

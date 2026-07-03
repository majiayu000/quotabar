import type { CSSProperties } from 'react';
import type { AppTabName, ProviderSummary } from '../services/provider_summary';

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
    <div className="provider-grid" aria-label="Providers">
      <button
        type="button"
        className={`provider-card overview-tab ${activeTab === 'overview' ? 'active' : ''}`}
        style={{ '--service-accent': 'var(--accent-color)' } as CSSProperties}
        aria-current={activeTab === 'overview' ? 'page' : undefined}
        title="Overview"
        onClick={() => onTabChange('overview')}
      >
        <span className="provider-card-icon" aria-hidden="true">Q</span>
        <span className="provider-card-copy">
          <span className="provider-card-label">Overview</span>
          <span className="provider-card-meta">All providers</span>
        </span>
      </button>

      {summaries.map((summary) => {
        const isActive = activeTab === summary.id;
        const style = { '--service-accent': summary.accent } as CSSProperties;

        return (
          <button
            key={summary.id}
            type="button"
            className={`provider-card ${isActive ? 'active' : ''}`}
            style={style}
            aria-current={isActive ? 'page' : undefined}
            title={summary.label}
            onClick={() => onTabChange(summary.id)}
          >
            <span className="provider-card-icon" aria-hidden="true">
              {summary.initials}
              <span className={`status-dot ${summary.connected ? 'connected' : 'disconnected'}`} />
            </span>
            <span className="provider-card-copy">
              <span className="provider-card-label">{summary.shortLabel}</span>
              <span className="provider-card-meta">
                {summary.statusText}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

import type { CSSProperties } from 'react';
import type { ProviderSummary, QuotaWindowSummary } from '../services/provider_summary';
import { progressStyle } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';

interface OverviewPanelProps {
  summaries: ProviderSummary[];
  mostConstrained: QuotaWindowSummary[];
  upcomingResets: QuotaWindowSummary[];
  onProviderSelect: (provider: TrayServiceName) => void;
}

function providerStyle(summary: ProviderSummary): CSSProperties {
  return { '--service-accent': summary.accent } as CSSProperties;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function renderWindowRow(window: QuotaWindowSummary) {
  return (
    <div className="overview-window-row" key={`${window.provider}-${window.label}`}>
      <div className="overview-window-main">
        <span className="overview-window-provider">{window.providerLabel}</span>
        <span className="overview-window-label">{window.label}</span>
      </div>
      <div className="overview-window-meter">
        <span className="overview-window-percent">{formatPercent(window.usedPercent)}</span>
        <span className="overview-meter-track" aria-hidden="true">
          <span className="overview-meter-fill" style={progressStyle(window.usedPercent)} />
        </span>
      </div>
      {window.resetLabel && (
        <span className="overview-window-reset">Reset {window.resetLabel}</span>
      )}
    </div>
  );
}

export default function OverviewPanel({
  summaries,
  mostConstrained,
  upcomingResets,
  onProviderSelect,
}: OverviewPanelProps) {
  return (
    <div className="overview-panel">
      <div className="overview-hero">
        <div>
          <div className="overview-kicker">QuotaBar</div>
          <h1>Provider overview</h1>
        </div>
        <div className="overview-health">
          <strong>{summaries.filter((summary) => summary.connected).length}</strong>
          <span>online</span>
        </div>
      </div>

      <div className="overview-provider-list">
        {summaries.map((summary) => (
          <button
            key={summary.id}
            type="button"
            className="overview-provider-tile"
            style={providerStyle(summary)}
            onClick={() => onProviderSelect(summary.id)}
          >
            <span className="overview-provider-icon" aria-hidden="true">{summary.initials}</span>
            <span className="overview-provider-copy">
              <span className="overview-provider-name">{summary.label}</span>
              <span className="overview-provider-status">{summary.statusText}</span>
            </span>
            <span className={`status-dot ${summary.connected ? 'connected' : 'disconnected'}`} />
          </button>
        ))}
      </div>

      <div className="section">
        <div className="section-title">Most constrained</div>
        {mostConstrained.length > 0 ? (
          <div className="overview-window-list">
            {mostConstrained.map(renderWindowRow)}
          </div>
        ) : (
          <div className="no-data">--</div>
        )}
      </div>

      {upcomingResets.length > 0 && (
        <div className="section">
          <div className="section-title">Upcoming resets</div>
          <div className="overview-reset-list">
            {upcomingResets.map((window) => (
              <div className="overview-reset-row" key={`${window.provider}-${window.label}-${window.resetAtMs}`}>
                <span>{window.providerLabel}</span>
                <strong>{window.label}</strong>
                <em>{window.resetLabel}</em>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import type { ProviderSummary, QuotaWindowSummary } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';
import { clampProgressValue, getProgressStyle } from '../utils/quota_format';
import CostSummarySection from './CostSummarySection';
import ProviderDetailHeader from './ProviderDetailHeader';
import ResetTimeline from './ResetTimeline';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';

const ALL_COST_SOURCES = ['claude', 'codex', 'cursor'] as const;

interface OverviewPanelProps {
  summaries: ProviderSummary[];
  mostConstrained: QuotaWindowSummary[];
  upcomingResets: QuotaWindowSummary[];
  costRefreshKey: number;
  onProviderSelect: (provider: TrayServiceName) => void;
  sections?: PanelSectionVisibility;
}

export default function OverviewPanel({
  summaries,
  mostConstrained,
  upcomingResets,
  costRefreshKey,
  onProviderSelect,
  sections = defaultPanelSections(),
}: OverviewPanelProps) {
  const connectedCount = summaries.filter((summary) => summary.connected).length;

  return (
    <div className="overview-panel">
      <ProviderDetailHeader
        service="claude"
        label="Overview"
        status={`${connectedCount} of ${summaries.length} connected`}
        plan="All providers"
        usedPercent={mostConstrained[0]?.usedPercent ?? null}
        usageLabel={mostConstrained[0] ? `${mostConstrained[0].providerLabel} · ${mostConstrained[0].label}` : undefined}
        tone={connectedCount > 0 ? 'online' : 'offline'}
      />

      <div className="section">
        <div className="section-title">Most constrained</div>
        <div className="quota-group">
          {mostConstrained.length > 0 ? mostConstrained.map((window, index) => (
            <button
              type="button"
              className={`quota-card overview-quota-row${index === 0 ? ' primary' : ''}`}
              key={`${window.provider}-${window.label}`}
              onClick={() => onProviderSelect(window.provider)}
              aria-label={`Open ${window.providerLabel}: ${window.label}, ${Math.round(window.usedPercent)}% used`}
            >
              <div className="quota-header">
                <span className="quota-label">{`${window.providerLabel} · ${window.label}`}</span>
                <span className="quota-value">{Math.round(window.usedPercent)}%</span>
              </div>
              <div
                className="progress-bar"
                role="progressbar"
                aria-label={`${window.providerLabel} ${window.label} usage`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={clampProgressValue(window.usedPercent)}
                aria-valuetext={`${Math.round(window.usedPercent)}% used`}
              >
                <div className="progress-fill" style={getProgressStyle(window.usedPercent)} />
              </div>
              {window.resetLabel && <div className="reset-time">Resets in {window.resetLabel}</div>}
            </button>
          )) : (
            <div className="no-data">No provider data</div>
          )}
        </div>
      </div>

      {sections.timeline && <ResetTimeline windows={upcomingResets} />}
      {sections.cost && (
        <CostSummarySection source={ALL_COST_SOURCES} refreshKey={costRefreshKey} showTrend={sections.trend} />
      )}
    </div>
  );
}

import type { ProviderSummary, QuotaWindowSummary } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';
import { getProgressStyle } from '../utils/quota_format';
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
  return (
    <div className="overview-panel">
      <ProviderDetailHeader
        service="claude"
        status={`${summaries.filter((summary) => summary.connected).length} connected`}
        plan="All providers"
        usedPercent={mostConstrained[0]?.usedPercent ?? null}
      />

      <div className="section">
        <div className="section-title">Most constrained</div>
        <div className="quota-group">
          {mostConstrained.length > 0 ? mostConstrained.map((window) => (
            <button
              type="button"
              className="quota-card overview-quota-row"
              key={`${window.provider}-${window.label}`}
              onClick={() => onProviderSelect(window.provider)}
            >
              <div className="quota-header">
                <span className="quota-label">{`${window.providerLabel} · ${window.label}`}</span>
                <span className="quota-value">{Math.round(window.usedPercent)}%</span>
              </div>
              <div className="progress-bar">
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

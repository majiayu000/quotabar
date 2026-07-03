import CostSummarySection from './CostSummarySection';
import QuotaCard from './QuotaCard';
import ProviderDetailHeader from './ProviderDetailHeader';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type { QuotaData } from '../types/models';
import { formatResetTime } from '../utils/quota_format';
import { buildClaudeQuotaWindows, sortMostConstrained } from '../services/provider_summary';
import { getHighUsageTip } from '../services/detail_helpers';

interface ClaudePanelProps {
  quota: QuotaData | null;
  loading: boolean;
  error: string | null;
  windowVisible: boolean;
  costRefreshKey: number;
  onRetry: () => void;
}

function formatClaudeResetTime(resetTime?: string): string {
  return formatResetTime(resetTime, {
    emptyLabel: 'N/A',
    expiredLabel: 'Soon',
    showZeroHours: true,
  });
}

function hasWeeklyData(quota: QuotaData): boolean {
  return Boolean(
    quota.weeklyTotal ||
      quota.weeklyOpus ||
      quota.weeklySonnet ||
      quota.weeklyDesign ||
      quota.weeklyFable5,
  );
}

export default function ClaudePanel({
  quota,
  loading,
  error,
  windowVisible,
  costRefreshKey,
  onRetry,
}: ClaudePanelProps) {
  const windows = buildClaudeQuotaWindows(quota);
  const topWindow = sortMostConstrained(windows)[0];

  return (
    <>
      {loading && !quota && (
        <div className="loading-state">Loading Claude quota...</div>
      )}

      {error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">{error}</span>
        </div>
      )}

      {!error && quota && (
        <div className="detail-stack">
          <ProviderDetailHeader
            service="claude"
            status={quota.connected ? 'Connected' : 'Offline'}
            plan="Claude Code"
            usedPercent={topWindow?.usedPercent ?? null}
          />
          <SmartTip message={getHighUsageTip(windows)} />

          <div className="section">
            <div className="section-title">
              CURRENT SESSION
              <span className="plan-tag">Claude Code</span>
            </div>
            {quota.session ? (
              <QuotaCard
                label="5-Hour Usage"
                percentage={Math.round(quota.session.percentage)}
                resetsIn={formatClaudeResetTime(quota.session.resetTime)}
              />
            ) : (
              <div className="no-data">No session data</div>
            )}
          </div>

          <div className="section">
            <div className="section-title">
              WEEKLY LIMITS
              <span className="plan-tag">Claude Code</span>
            </div>

            {quota.weeklyTotal && (
              <QuotaCard
                label="7-Day Usage"
                percentage={Math.round(quota.weeklyTotal.percentage)}
                resetsIn={formatClaudeResetTime(quota.weeklyTotal.resetTime)}
              />
            )}

            {quota.weeklyOpus && (
              <QuotaCard
                label="Opus (7-Day)"
                percentage={Math.round(quota.weeklyOpus.percentage)}
                resetsIn={formatClaudeResetTime(quota.weeklyOpus.resetTime)}
              />
            )}

            {quota.weeklySonnet && (
              <QuotaCard
                label="Sonnet (7-Day)"
                percentage={Math.round(quota.weeklySonnet.percentage)}
                resetsIn={formatClaudeResetTime(quota.weeklySonnet.resetTime)}
              />
            )}

            {quota.weeklyDesign && (
              <QuotaCard
                label="Claude Design (7-Day)"
                percentage={Math.round(quota.weeklyDesign.percentage)}
                resetsIn={formatClaudeResetTime(quota.weeklyDesign.resetTime)}
              />
            )}

            {quota.weeklyFable5 && (
              <QuotaCard
                label="Fable 5 (7-Day)"
                percentage={Math.round(quota.weeklyFable5.percentage)}
                resetsIn={formatClaudeResetTime(quota.weeklyFable5.resetTime)}
              />
            )}

            {!hasWeeklyData(quota) && (
              <div className="no-data">No weekly data</div>
            )}
          </div>

          <ResetTimeline windows={windows} />

          {windowVisible && (
            <CostSummarySection source="claude" refreshKey={costRefreshKey} />
          )}
        </div>
      )}

      {!error && !quota && !loading && (
        <div className="empty-state">
          <p>Unable to load quota data</p>
          <button onClick={onRetry} className="retry-btn">
            Try Again
          </button>
        </div>
      )}
    </>
  );
}

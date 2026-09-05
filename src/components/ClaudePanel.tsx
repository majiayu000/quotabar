import { workspaceCopy } from '../utils/quota_format';
import QuotaRecovery, { quotaRecovery, useQuotaCooldown } from './QuotaRecovery';
import CostSummarySection from './CostSummarySection';
import QuotaCard from './QuotaCard';
import ProviderDetailHeader from './ProviderDetailHeader';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type { QuotaData } from '../types/models';
import { formatPaceText, formatResetTime } from '../utils/quota_format';
import { buildClaudeQuotaWindows, sortMostConstrained } from '../services/provider_summary';
import { getHighUsageTip } from '../services/detail_helpers';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';

interface ClaudePanelProps {
  workspace?: boolean;
  retryAt?: number | null;
  quota: QuotaData | null;
  loading: boolean;
  error: string | null;
  windowVisible: boolean;
  costRefreshKey: number;
  onRetry: () => void;
  sections?: PanelSectionVisibility;
}

const SESSION_WINDOW_MINUTES = 5 * 60;

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
  workspace = false,
  retryAt,
  loading,
  error,
  windowVisible,
  costRefreshKey,
  onRetry,
  sections = defaultPanelSections(),
}: ClaudePanelProps) {
  const cooling = useQuotaCooldown(retryAt);
  const loginNeeded = /登录/.test(quotaRecovery('claude', error)?.title ?? '');
  const windows = buildClaudeQuotaWindows(quota);
  const topWindow = sortMostConstrained(windows)[0];

  return (
    <>
      {loading && !quota && (
        <div className="loading-state">Loading Claude quota...</div>
      )}

      {error && (workspace ? <QuotaRecovery provider="claude" read={{ error, readAt: null, retryAt }} hasData={Boolean(quota?.connected)} /> :
        <div className="error-banner" role="alert">
          <span className="error-icon">!</span>
          <span className="error-text">
            {error}
            {quota && <span className="error-context">{workspaceCopy("Showing last known data.", "当前显示上次成功读取的数据。")}</span>}
          </span>
        </div>
      )}

      {quota && (
        <div className="detail-stack">
          <ProviderDetailHeader
            service="claude"
            status={error ? 'Stale data' : quota.connected ? 'Connected' : 'Offline'}
            plan="Claude Code"
            usedPercent={topWindow?.usedPercent ?? null}
            usageLabel={topWindow?.label}
            tone={error ? 'pending' : quota.connected ? 'online' : 'offline'}
          />

          <div className="section">
            <div className="section-title">{workspaceCopy("Current session", "当前窗口")}</div>
            <div className="quota-group">
              {quota.session ? (
                <QuotaCard
                  label="5-hour window"
                  percentage={Math.round(quota.session.percentage)}
                  resetsIn={formatClaudeResetTime(quota.session.resetTime)}
                  pace={formatPaceText(quota.session.percentage, quota.session.resetTime, SESSION_WINDOW_MINUTES)}
                />
              ) : (
                <div className="no-data">No session data</div>
              )}
            </div>
          </div>

          <div className="section">
            <div className="section-title">{workspaceCopy("Weekly limits", "每周额度")}</div>
            <div className="quota-group">
              {quota.weeklyTotal && (
                <QuotaCard
                  label="All models"
                  percentage={Math.round(quota.weeklyTotal.percentage)}
                  resetsIn={formatClaudeResetTime(quota.weeklyTotal.resetTime)}
                  featured
                />
              )}

              {quota.weeklyOpus && (
                <QuotaCard
                  label="Opus"
                  percentage={Math.round(quota.weeklyOpus.percentage)}
                  resetsIn={formatClaudeResetTime(quota.weeklyOpus.resetTime)}
                />
              )}

              {quota.weeklySonnet && (
                <QuotaCard
                  label="Sonnet"
                  percentage={Math.round(quota.weeklySonnet.percentage)}
                  resetsIn={formatClaudeResetTime(quota.weeklySonnet.resetTime)}
                />
              )}

              {quota.weeklyDesign && (
                <QuotaCard
                  label="Claude Design"
                  percentage={Math.round(quota.weeklyDesign.percentage)}
                  resetsIn={formatClaudeResetTime(quota.weeklyDesign.resetTime)}
                />
              )}

              {quota.weeklyFable5 && (
                <QuotaCard
                  label="Fable 5"
                  percentage={Math.round(quota.weeklyFable5.percentage)}
                  resetsIn={formatClaudeResetTime(quota.weeklyFable5.resetTime)}
                />
              )}

              {!hasWeeklyData(quota) && (
                <div className="no-data">{workspaceCopy("No weekly data", "尚无每周额度数据")}</div>
              )}
            </div>
          </div>

          {sections.tips && <SmartTip message={getHighUsageTip(windows)} />}

          {sections.timeline && <ResetTimeline windows={windows} />}

          {sections.cost && windowVisible && (
            <CostSummarySection source="claude" refreshKey={costRefreshKey} showTrend={sections.trend} />
          )}
        </div>
      )}

      {!quota && !loading && (
        <div className="empty-state">
          <p>{workspaceCopy("Unable to load quota data", "无法读取额度数据")}</p>
          <button type="button" onClick={onRetry} disabled={cooling} className="retry-btn">
            {cooling ? "等待重试" : loginNeeded && workspace ? "我已登录，重新检测" : workspaceCopy("Try Again", "重新读取")}
          </button>
        </div>
      )}
    </>
  );
}

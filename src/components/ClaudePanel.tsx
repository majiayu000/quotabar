import { localizeLabel, t } from '../i18n';
import { useLocale } from '../i18n/react';
import QuotaRecovery, { quotaRecovery, useQuotaCooldown } from './QuotaRecovery';
import ProviderSetup from './ProviderSetup';
import CostSummarySection from './CostSummarySection';
import QuotaCard from './QuotaCard';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type { QuotaData } from '../types/models';
import { formatPaceText, formatResetTime } from '../utils/quota_format';
import { buildClaudeQuotaWindows } from '../services/provider_summary';
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
    emptyLabel: t("N/A"),
    expiredLabel: t("soon"),
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
  useLocale();
  const cooling = useQuotaCooldown(retryAt);
  const loginNeeded = quotaRecovery('claude', error)?.requiresLogin === true;
  const windows = buildClaudeQuotaWindows(quota);

  return (
    <>
      {loading && !quota && (
        <div className="loading-state">{t("Loading Claude quota…")}</div>
      )}

      {error && (workspace ? <QuotaRecovery provider="claude" read={{ error, readAt: null, retryAt }} hasData={Boolean(quota?.connected)} /> :
        <div className="error-banner" role="alert">
          <span className="error-icon">!</span>
          <span className="error-text">
            {localizeLabel(error)}
            {quota && <span className="error-context">{t("Showing last known data.")}</span>}
          </span>
        </div>
      )}

      {quota && (
        <div className="detail-stack">
          <div className="section">
            <div className="section-title">{t("Current session")}</div>
            <div className="quota-group">
              {quota.session ? (
                <QuotaCard
                  label={t("5-hour quota")}
                  percentage={Math.round(quota.session.percentage)}
                  resetsIn={formatClaudeResetTime(quota.session.resetTime)}
                  pace={formatPaceText(quota.session.percentage, quota.session.resetTime, SESSION_WINDOW_MINUTES)}
                />
              ) : (
                <div className="no-data">{t("No current window data")}</div>
              )}
            </div>
          </div>

          <div className="section">
            <div className="section-title">{t("Weekly limits")}</div>
            <div className="quota-group">
              {quota.weeklyTotal && (
                <QuotaCard
                  label={t("All models")}
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
                <div className="no-data">{t("No weekly data")}</div>
              )}
            </div>
          </div>

          {sections.tips && !error && <SmartTip message={getHighUsageTip(windows)} />}

          {sections.timeline && <ResetTimeline windows={windows} />}

          {sections.cost && windowVisible && (
            <CostSummarySection source="claude" refreshKey={costRefreshKey} showTrend={sections.trend} />
          )}
        </div>
      )}

      {!quota && !loading && (
        <div className="empty-state">
          <p>{t("Unable to load quota data")}</p>
          {workspace ? (
            <button type="button" onClick={onRetry} disabled={cooling} className="retry-btn">
              {cooling ? t("Waiting to retry") : loginNeeded ? t("Signed in, check again") : t("Read again")}
            </button>
          ) : <ProviderSetup service="claude" onRetry={onRetry} loading={loading || cooling} />}
        </div>
      )}
    </>
  );
}

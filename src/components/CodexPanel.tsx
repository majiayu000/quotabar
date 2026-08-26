import { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import { backend } from '../services/backend';
import CostSummarySection from './CostSummarySection';
import ProviderDetailHeader from './ProviderDetailHeader';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type {
  CodexData,
  CodexRateLimitWindow,
  CodexRateLimits,
  CodexResetCredit,
  CodexResetCredits,
  CodexWeeklyQuota,
  CodexWeeklyValueEstimate,
} from '../types/models';
import { buildCodexQuotaWindows, sortMostConstrained, type QuotaWindowSummary } from '../services/provider_summary';
import { getAvailableResetCredits, getHighUsageTip } from '../services/detail_helpers';
import { clampProgressValue, formatPaceText, formatPlanType, formatResetTime, getProgressStyle } from '../utils/quota_format';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';

interface CodexPanelProps {
  onConnectionChange?: (connected: boolean) => void;
  onUsageChange?: (usedPercent: number | null) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
  onQuotaWindowsChange?: (windows: QuotaWindowSummary[]) => void;
  showCostSummary?: boolean;
  sections?: PanelSectionVisibility;
  onBonusExpiring?: (daysLeft: number) => void;
}

function formatSubscriptionDate(dateStr?: string): string {
  if (!dateStr) return 'Unknown';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatCodexPlan(planType?: string): string {
  return `ChatGPT ${formatPlanType(planType, 'Pro')}`;
}

function formatWindowLabel(minutes?: number, kind: 'primary' | 'secondary' = 'primary'): string {
  if (!minutes) return 'Limit';
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    if (days === 7) return kind === 'secondary' ? 'Weekly limit' : '7-day window';
    return `${days}d ${kind === 'secondary' ? 'limit' : 'window'}`;
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours}-hour window`;
  }
  return `${minutes}m`;
}

function formatResetAt(value?: number): string {
  if (!value) return '';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (sameDay) return `Today, ${time}`;
  const day = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${day}, ${time}`;
}

function formatGrantDate(value?: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

const USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT_TOKEN_FORMAT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function validateWeeklyValueEstimate(
  estimate: CodexWeeklyValueEstimate,
  official: CodexRateLimitWindow,
): string | null {
  if (
    !Number.isFinite(estimate.observedCostUsd)
    || estimate.observedCostUsd <= 0
    || !Number.isFinite(estimate.estimatedWeeklyValueUsd)
    || estimate.estimatedWeeklyValueUsd <= 0
    || !Number.isFinite(estimate.observedTokens)
    || estimate.observedTokens <= 0
    || !Number.isFinite(estimate.estimatedWeeklyTokens)
    || estimate.estimatedWeeklyTokens <= 0
  ) {
    return 'The local weekly value estimate contains invalid totals.';
  }
  if (Math.abs(estimate.usedPct - official.usedPercent) > 5) {
    return 'The local weekly value estimate does not match the quota usage.';
  }
  const estimateObservedAt = Date.parse(estimate.observedAt);
  const now = Date.now();
  if (
    !Number.isFinite(estimateObservedAt)
    || estimateObservedAt > now + 5 * 60 * 1000
    || now - estimateObservedAt > 10 * 60 * 1000
  ) {
    return 'The local weekly value estimate is stale or has an invalid observation time.';
  }
  const estimateReset = Date.parse(estimate.resetsAt);
  const officialReset = (official.resetsAt ?? 0) * 1000;
  if (
    !Number.isFinite(estimateReset)
    || officialReset <= 0
    || Math.abs(estimateReset - officialReset) > 5 * 60 * 1000
  ) {
    return 'The local weekly value estimate does not match the quota reset.';
  }
  return null;
}

function validateWeeklyQuotaWindow(
  quota: CodexWeeklyQuota,
  official?: CodexRateLimits['secondary'],
): string | null {
  if (!official) return 'The official weekly quota window is unavailable.';
  if (!Number.isFinite(official.windowMinutes) || (official.windowMinutes ?? 0) <= 0) {
    return 'The official weekly window length is unavailable.';
  }
  if (official.windowMinutes !== quota.windowMinutes) {
    return 'The local pace snapshot does not match the official weekly window.';
  }
  const officialReset = official.resetsAt;
  if (!Number.isFinite(officialReset) || (officialReset ?? 0) <= 0) {
    return 'The official weekly reset time is unavailable.';
  }
  const localReset = Date.parse(quota.resetsAt) / 1000;
  if (!Number.isFinite(localReset) || localReset <= 0) {
    return 'The local pace snapshot has an invalid reset time.';
  }
  if (Math.abs(localReset - (officialReset ?? 0)) > 5 * 60) {
    return 'The local pace snapshot does not match the current official reset.';
  }
  const observedAt = Date.parse(quota.observedAt);
  const now = Date.now();
  if (!Number.isFinite(observedAt)) {
    return 'The local pace snapshot has an invalid observation time.';
  }
  if (observedAt > now + 5 * 60 * 1000) {
    return 'The local pace snapshot is dated in the future.';
  }
  if (now - observedAt > 30 * 60 * 1000) {
    return 'The local pace snapshot is older than 30 minutes.';
  }
  if (Math.abs(quota.usedPct - official.usedPercent) > 1) {
    return 'The local pace usage does not match the current official usage.';
  }
  return null;
}

function selectOfficialWeeklyWindow(
  limits: CodexRateLimits | null,
  quota: CodexWeeklyQuota | null,
): CodexRateLimitWindow | undefined {
  const candidates = [limits?.secondary, limits?.primary].filter(
    (window): window is CodexRateLimitWindow => window != null,
  );
  if (quota) {
    const exact = candidates.find((window) => window.windowMinutes === quota.windowMinutes);
    if (exact) return exact;
  }
  return candidates.find((window) => window.windowMinutes === 10_080)
    ?? limits?.secondary
    ?? limits?.primary;
}

function selectOfficialWeeklyLimitWindow(
  limits: CodexRateLimits | null,
): CodexRateLimitWindow | undefined {
  return [limits?.secondary, limits?.primary].find(
    (window): window is CodexRateLimitWindow => window?.windowMinutes === 10_080,
  );
}

const BONUS_EXPIRY_REMINDER_DAYS = 3;

function getDaysLeft(value?: string): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

interface BonusGrantGroup {
  key: string;
  count: number;
  grantedAt?: string;
  expiresAt?: string;
}

function buildBonusGrantGroups(credits: CodexResetCredit[]): BonusGrantGroup[] {
  const groups = new Map<string, BonusGrantGroup>();
  for (const credit of credits) {
    const key = `${credit.grantedAt ?? 'unknown'}-${credit.expiresAt ?? 'unknown'}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(key, {
      key,
      count: 1,
      grantedAt: credit.grantedAt,
      expiresAt: credit.expiresAt,
    });
  }
  return Array.from(groups.values());
}

function getTrayUsedPercent(limits: CodexRateLimits): number | null {
  if (limits.secondary?.usedPercent != null) {
    return limits.secondary.usedPercent;
  }
  if (limits.primary?.usedPercent != null) {
    return limits.primary.usedPercent;
  }
  return null;
}

export default function CodexPanel({
  onConnectionChange,
  onUsageChange,
  autoRefreshIntervalMs = 60 * 1000,
  manualRefreshNonce = 0,
  onLoadingChange,
  onQuotaWindowsChange,
  showCostSummary = true,
  sections = defaultPanelSections(),
  onBonusExpiring,
}: CodexPanelProps) {
  const [codexData, setCodexData] = useState<CodexData | null>(null);
  const [rateLimits, setRateLimits] = useState<CodexRateLimits | null>(null);
  const [resetCredits, setResetCredits] = useState<CodexResetCredits | null>(null);
  const [weeklyQuota, setWeeklyQuota] = useState<CodexWeeklyQuota | null>(null);
  const [weeklyQuotaError, setWeeklyQuotaError] = useState<string | null>(null);
  const [weeklyValueEstimate, setWeeklyValueEstimate] = useState<CodexWeeklyValueEstimate | null>(null);
  const [weeklyValueEstimateError, setWeeklyValueEstimateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitsError, setRateLimitsError] = useState<string | null>(null);
  const hasResolvedData = useRef(false);
  const request_generation = useLatestRequestGeneration();
  const weekly_request_generation = useLatestRequestGeneration();

  const fetchWeeklyQuota = useCallback(async () => {
    const generation = weekly_request_generation.begin();
    try {
      const weekly = await backend.getCodexWeeklyQuota();
      if (!weekly_request_generation.isCurrent(generation)) return;
      setWeeklyQuota(weekly.quota ?? null);
      setWeeklyQuotaError(weekly.error ?? null);
      setWeeklyValueEstimate(weekly.valueEstimate ?? null);
      setWeeklyValueEstimateError(weekly.valueEstimateError ?? null);
    } catch (err) {
      if (!weekly_request_generation.isCurrent(generation)) return;
      setWeeklyQuota(null);
      setWeeklyQuotaError(
        err instanceof Error ? err.message : 'Failed to load local weekly pace',
      );
      setWeeklyValueEstimate(null);
      setWeeklyValueEstimateError(null);
    }
  }, [weekly_request_generation]);

  const fetchData = useCallback(async () => {
    const generation = request_generation.begin();
    try {
      setLoading(true);
      setError(null);
      setRateLimitsError(null);
      void fetchWeeklyQuota();

      const [info, limits, credits] = await Promise.all([
        backend.getCodexInfo(),
        backend.getCodexRateLimits(),
        backend.getCodexResetCredits(),
      ]);
      if (!request_generation.isCurrent(generation)) return;

      hasResolvedData.current = true;
      setCodexData(info);
      setRateLimits(limits);
      onQuotaWindowsChange?.(buildCodexQuotaWindows(limits));
      setResetCredits(credits);

      if (limits.error) {
        setError(limits.error);
        setRateLimitsError(limits.error);
      } else if (info.error) {
        setError(info.error);
      }

      // Notify parent about connection status change
      const isConnected = limits.connected || info.connected;
      onConnectionChange?.(isConnected);

      // Use weekly usage for tray when available (secondary window).
      onUsageChange?.(getTrayUsedPercent(limits));
    } catch (err) {
      if (!request_generation.isCurrent(generation)) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch Codex data';
      setError(message);
      setRateLimitsError(message);
      if (!hasResolvedData.current) {
        onConnectionChange?.(false);
        onUsageChange?.(null);
        onQuotaWindowsChange?.([]);
      }
    } finally {
      if (request_generation.isCurrent(generation)) {
        setLoading(false);
      }
    }
  }, [fetchWeeklyQuota, onConnectionChange, onQuotaWindowsChange, onUsageChange, request_generation]);

  useEffect(() => {
    fetchData();
    // Refresh in background at configured interval; 0 pauses polling.
    if (autoRefreshIntervalMs <= 0) return;
    const interval = setInterval(fetchData, autoRefreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, autoRefreshIntervalMs]);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (manualRefreshNonce > 0) {
      fetchData();
    }
  }, [manualRefreshNonce, fetchData]);

  useEffect(() => {
    if (!onBonusExpiring) return;
    for (const group of buildBonusGrantGroups(getAvailableResetCredits(resetCredits))) {
      const daysLeft = getDaysLeft(group.expiresAt);
      if (daysLeft != null && daysLeft <= BONUS_EXPIRY_REMINDER_DAYS) {
        onBonusExpiring(daysLeft);
      }
    }
  }, [resetCredits, onBonusExpiring]);

  if (loading && !codexData && !rateLimits) {
    return (
      <div className="codex-panel">
        <div className="loading-state">Loading Codex info...</div>
      </div>
    );
  }

  const hasRateLimits = Boolean(rateLimits?.primary || rateLimits?.secondary);
  const connected = rateLimits?.connected || codexData?.connected;
  const planType = rateLimits?.planType || codexData?.planType;
  const windows = buildCodexQuotaWindows(rateLimits);
  const topWindow = sortMostConstrained(windows)[0];
  const showingStaleLimits = Boolean(rateLimitsError && hasRateLimits);
  const quotaUnavailable = Boolean(rateLimitsError && !hasRateLimits);
  const availableResetCredits = getAvailableResetCredits(resetCredits);
  const bonusGrantGroups = buildBonusGrantGroups(availableResetCredits);
  const officialWeeklyWindow = selectOfficialWeeklyWindow(rateLimits, weeklyQuota);
  const officialWeeklyLimit = selectOfficialWeeklyLimitWindow(rateLimits);
  const weeklyQuotaValidationError = weeklyQuota
    ? validateWeeklyQuotaWindow(weeklyQuota, officialWeeklyWindow)
    : null;
  const displayedWeeklyQuota = weeklyQuotaValidationError ? null : weeklyQuota;
  const displayedWeeklyQuotaError = weeklyQuotaValidationError ?? weeklyQuotaError;
  const weeklyValueValidationError = officialWeeklyLimit && weeklyValueEstimate
    ? validateWeeklyValueEstimate(weeklyValueEstimate, officialWeeklyLimit)
    : null;
  const displayedWeeklyValueEstimate = weeklyValueValidationError || !officialWeeklyLimit
    ? null
    : weeklyValueEstimate;
  const displayedWeeklyValueEstimateError = officialWeeklyLimit
    ? (weeklyValueValidationError ?? weeklyValueEstimateError)
    : null;
  const renderWeeklyPace = (window: CodexRateLimitWindow) => {
    if (window !== officialWeeklyWindow) return null;
    if (!displayedWeeklyQuota && displayedWeeklyQuotaError) {
      return (
        <span className="quota-pace warning">
          Local pace unavailable: {displayedWeeklyQuotaError}
        </span>
      );
    }
    return null;
  };

  return (
    <div className="codex-panel">
      {error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">
            {error}
            {showingStaleLimits && <span className="error-context">Showing last known data.</span>}
          </span>
        </div>
      )}

      {connected && (
        <div className="codex-content">
          <ProviderDetailHeader
            service="codex"
            status={showingStaleLimits ? 'Stale data' : quotaUnavailable ? 'Quota unavailable' : connected ? 'Connected' : 'Offline'}
            plan={formatCodexPlan(planType)}
            usedPercent={topWindow?.usedPercent ?? null}
            usageLabel={topWindow?.label}
            tone={showingStaleLimits ? 'pending' : quotaUnavailable ? 'error' : connected ? 'online' : 'offline'}
          />

          {/* Rate Limits Section */}
          {hasRateLimits && (
            <div className="section">
              <div className="section-title">Usage</div>

              <div className="quota-group">
                {rateLimits?.primary && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">
                        {formatWindowLabel(rateLimits.primary.windowMinutes, 'primary')}
                      </span>
                      <span className="quota-value">
                        {Math.round(rateLimits.primary.usedPercent)}%
                      </span>
                    </div>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-label={`${formatWindowLabel(rateLimits.primary.windowMinutes, 'primary')} usage`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={clampProgressValue(rateLimits.primary.usedPercent)}
                      aria-valuetext={`${Math.round(rateLimits.primary.usedPercent)}% used`}
                    >
                      <div
                        className="progress-fill"
                        style={getProgressStyle(rateLimits.primary.usedPercent)}
                      />
                    </div>
                    {rateLimits.primary.resetsAt && (
                      <div className="reset-time">
                        <span>Resets in {formatResetTime(rateLimits.primary.resetsAt)}</span>
                        <span>{formatResetAt(rateLimits.primary.resetsAt)}</span>
                      </div>
                    )}
                    {(() => {
                      const pace = formatPaceText(
                        rateLimits.primary.usedPercent,
                        rateLimits.primary.resetsAt,
                        rateLimits.primary.windowMinutes,
                      );
                      return pace ? (
                        <span className={`quota-pace ${rateLimits.primary.usedPercent >= 50 ? 'warning' : ''}`}>
                          {pace}
                        </span>
                      ) : null;
                    })()}
                    {renderWeeklyPace(rateLimits.primary)}
                  </div>
                )}

                {rateLimits?.secondary && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">
                        {formatWindowLabel(rateLimits.secondary.windowMinutes, 'secondary')}
                      </span>
                      <span className="quota-value">
                        {Math.round(rateLimits.secondary.usedPercent)}%
                      </span>
                    </div>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-label={`${formatWindowLabel(rateLimits.secondary.windowMinutes, 'secondary')} usage`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={clampProgressValue(rateLimits.secondary.usedPercent)}
                      aria-valuetext={`${Math.round(rateLimits.secondary.usedPercent)}% used`}
                    >
                      <div
                        className="progress-fill"
                        style={getProgressStyle(rateLimits.secondary.usedPercent)}
                      />
                    </div>
                    {rateLimits.secondary.resetsAt && (
                      <div className="reset-time">
                        <span>Resets in {formatResetTime(rateLimits.secondary.resetsAt)}</span>
                        <span>{formatResetAt(rateLimits.secondary.resetsAt)}</span>
                      </div>
                    )}
                    {renderWeeklyPace(rateLimits.secondary)}
                  </div>
                )}

                {rateLimits?.credits?.hasCredits && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">Credits</span>
                      <span className="quota-value">
                        {rateLimits.credits.unlimited
                          ? 'Unlimited'
                          : rateLimits.credits.balance || '0'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {officialWeeklyLimit
            && (displayedWeeklyValueEstimate || displayedWeeklyValueEstimateError) && (
            <div className="section weekly-value-section">
              <div className="quota-group">
                <div className="quota-card weekly-value-card">
                  {displayedWeeklyValueEstimate ? (
                    <>
                      <div className="weekly-value-topline">
                        <span className="weekly-value-title">
                          <span className="weekly-value-dot" />
                          API-equivalent week
                        </span>
                        <span className="weekly-value-badge">Local estimate</span>
                      </div>
                      <div className="weekly-value-body">
                        <div className="weekly-value-metrics">
                          <span className="weekly-value-amount">
                          ≈{USD_FORMAT.format(displayedWeeklyValueEstimate.estimatedWeeklyValueUsd)}
                          </span>
                          <span className="weekly-value-token-row">
                            <strong>
                              ≈{COMPACT_TOKEN_FORMAT.format(displayedWeeklyValueEstimate.estimatedWeeklyTokens)}
                            </strong>
                            <span>tokens at current mix</span>
                          </span>
                        </div>
                        <div
                          className="weekly-value-gauge"
                          role="img"
                          aria-label={`Estimate based on ${Math.round(displayedWeeklyValueEstimate.usedPct)}% used`}
                          style={{
                            '--weekly-value-used': `${Math.min(Math.max(displayedWeeklyValueEstimate.usedPct, 0), 100)}%`,
                          } as CSSProperties}
                        >
                          <span className="weekly-value-gauge-center">
                            <strong>{Math.round(displayedWeeklyValueEstimate.usedPct)}%</strong>
                            <small>used</small>
                          </span>
                        </div>
                      </div>
                      <div className="weekly-value-footer weekly-value-footer-basis">
                        <span>
                          {`Based on ${Math.round(displayedWeeklyValueEstimate.usedPct)}% used · ${USD_FORMAT.format(displayedWeeklyValueEstimate.observedCostUsd)} local`}
                        </span>
                        <span>
                          {`${COMPACT_TOKEN_FORMAT.format(displayedWeeklyValueEstimate.observedTokens)} observed tokens · Not an official allowance`}
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className="quota-pace warning">
                      Weekly value unavailable: {displayedWeeklyValueEstimateError}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {sections.tips && <SmartTip message={getHighUsageTip(windows)} />}

          {/* Bonus Reset Credits Section */}
          {availableResetCredits.length > 0 && (
            <div className="bonus-panel">
              <div className="bonus-header">
                <div className="bonus-title-row">
                  <span className="bonus-title">Bonus resets</span>
                  <span className="bonus-badge">Gifted</span>
                </div>
                <span className="bonus-count">{availableResetCredits.length} available</span>
              </div>
              <div className="bonus-grants">
                {bonusGrantGroups.map((group) => {
                  const daysLeft = getDaysLeft(group.expiresAt);
                  return (
                  <div className="bonus-grant-row" key={group.key}>
                    <span className="bonus-grant-left">
                      <span className="bonus-dot" />
                      <span className="bonus-grant-label">
                        +{group.count} · granted {formatGrantDate(group.grantedAt)}
                      </span>
                    </span>
                    <span className={`bonus-grant-right ${daysLeft != null && daysLeft <= 10 ? 'warning' : ''}`}>
                      {daysLeft == null ? 'Expires unknown' : `${daysLeft}d left · ${formatGrantDate(group.expiresAt)}`}
                    </span>
                  </div>
                  );
                })}
              </div>
              <div className="bonus-note">Gifted occasionally · no cap · each grant valid 30 days</div>
            </div>
          )}

          {sections.timeline && <ResetTimeline windows={windows} />}

          {/* Subscription Section (only if no rate limits) */}
          {!hasRateLimits && codexData && (
            <div className="section">
              <div className="section-title">Subscription</div>
              <div className="quota-group">
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">Plan</span>
                    <span className="quota-value plan-badge">
                      {formatPlanType(planType)}
                    </span>
                  </div>
                </div>
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">Valid Until</span>
                    <span className="quota-value">
                      {formatSubscriptionDate(codexData.subscriptionUntil)}
                    </span>
                  </div>
                </div>
                {codexData.email && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">Account</span>
                      <span className="quota-value email">{codexData.email}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {sections.cost && showCostSummary && (
            <CostSummarySection source="codex" refreshKey={manualRefreshNonce} showTrend={sections.trend} />
          )}

        </div>
      )}

      {!connected && !error && (
        <div className="empty-state">
          <p>Codex not connected</p>
          <p className="hint">Run 'codex' in terminal to login</p>
        </div>
      )}
    </div>
  );
}

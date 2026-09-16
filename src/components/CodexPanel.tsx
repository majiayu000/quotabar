import { localizeLabel, getLocale, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { backend } from '../services/backend';
import weeklyReference from '../services/codex_weekly_reference.json';
import CostSummarySection from './CostSummarySection';
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
  CodexWeeklyValueError,
} from '../types/models';
import { buildCodexQuotaWindows, type QuotaWindowSummary } from '../services/provider_summary';
import { canReportBonusReady } from '../services/bonus_ready';
import {
  checkWeeklyQuotaWindow,
  checkWeeklyValueEstimate,
  formatLocalExtrasPaused,
  getWeeklyTokenCapacity,
  isHardDisplayCheck,
  isSoftDisplayCheck,
  isWeeklyExhausted,
} from '../services/codex_weekly_display';
import { getAvailableResetCredits, getExhaustedWeekTip, getHighUsageTip } from '../services/detail_helpers';
import { remainingPercent, formatPaceText, formatPlanType, formatResetTime, getRemainingProgressStyle } from '../utils/quota_format';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';

interface CodexPanelProps {
  onConnectionChange?: (connected: boolean) => void;
  onUsageChange?: (usedPercent: number | null) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
  onQuotaWindowsChange?: (windows: QuotaWindowSummary[]) => void;
  onReadResult?: (error: string | null) => void;
  showCostSummary?: boolean;
  sections?: PanelSectionVisibility;
  onBonusExpiring?: (daysLeft: number) => void;
  onBonusReadyChange?: (ready: { exhausted: boolean; availableCount: number }) => void;
  onOpenDashboard?: () => void;
}

function formatSubscriptionDate(dateStr?: string): string {
  if (!dateStr) return t("Unknown");
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(getLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatWindowLabel(minutes?: number, kind: 'primary' | 'secondary' = 'primary'): string {
  if (!minutes) return t("Limit");
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    if (days === 7) return kind === 'secondary' ? t("Weekly quota") : t("7-day quota");
    return t("{count}-day quota", { count: days });
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return t("{p0}-hour quota", { p0: hours });
  }
  return t("{count}m", { count: minutes });
}

function formatResetAt(value?: number): string {
  if (!value) return '';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(getLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (sameDay) return t("Today {p0}", { p0: time });
  const day = date.toLocaleDateString(getLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${day}, ${time}`;
}

function formatGrantDate(value?: string): string {
  if (!value) return t("Unknown");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(getLocale(), {
    month: 'short',
    day: 'numeric',
  });
}

const USD_FORMAT = () => (new Intl.NumberFormat(getLocale(), {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}));

const COMPACT_TOKEN_FORMAT = () => (new Intl.NumberFormat(getLocale(), {
  notation: 'compact',
  maximumFractionDigits: 1,
}));


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
  onReadResult,
  showCostSummary = true,
  sections = defaultPanelSections(),
  onBonusExpiring,
  onBonusReadyChange,
  onOpenDashboard,
}: CodexPanelProps) {
  useLocale();
  const [codexData, setCodexData] = useState<CodexData | null>(null);
  const [rateLimits, setRateLimits] = useState<CodexRateLimits | null>(null);
  const [resetCredits, setResetCredits] = useState<CodexResetCredits | null>(null);
  const [weeklyQuota, setWeeklyQuota] = useState<CodexWeeklyQuota | null>(null);
  const [weeklyQuotaError, setWeeklyQuotaError] = useState<string | null>(null);
  const [weeklyValueEstimate, setWeeklyValueEstimate] = useState<CodexWeeklyValueEstimate | null>(null);
  const [weeklyValueEstimateError, setWeeklyValueEstimateError] = useState<CodexWeeklyValueError | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitsError, setRateLimitsError] = useState<string | null>(null);
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
        err instanceof Error ? err.message : "Failed to load local weekly pace",
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

      setCodexData(info);
      setRateLimits(limits);
      onQuotaWindowsChange?.(buildCodexQuotaWindows(limits));
      onReadResult?.(limits.error ?? info.error ?? (limits.connected && (limits.primary || limits.secondary) ? null : t("Quota unavailable")));
      setResetCredits(credits);

      if (limits.error) {
        setError(limits.error);
        setRateLimitsError(limits.error);
      } else {
        if (info.error) {
          setError(info.error);
        }
      }

      // Notify parent about connection status change
      const isConnected = limits.connected || info.connected;
      onConnectionChange?.(isConnected);

      // Use weekly usage for tray when available (secondary window).
      onUsageChange?.(getTrayUsedPercent(limits));
    } catch (err) {
      if (!request_generation.isCurrent(generation)) return;
      const message = err instanceof Error ? err.message : "Failed to fetch Codex data";
      setError(message);
      onReadResult?.(message);
      setRateLimitsError(message);
      onConnectionChange?.(false);
      onUsageChange?.(null);
      onQuotaWindowsChange?.([]);
    } finally {
      if (request_generation.isCurrent(generation)) {
        setLoading(false);
      }
    }
  }, [fetchWeeklyQuota, onConnectionChange, onQuotaWindowsChange, onReadResult, onUsageChange, request_generation]);

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

  const officialWeeklyLimit = selectOfficialWeeklyLimitWindow(rateLimits);
  const weeklyExhausted = isWeeklyExhausted(officialWeeklyLimit?.usedPercent);
  const availableResetCredits = getAvailableResetCredits(resetCredits);

  useEffect(() => {
    if (
      !onBonusReadyChange
      || !canReportBonusReady(
        resetCredits,
        officialWeeklyLimit?.usedPercent,
        availableResetCredits.length,
      )
    ) return;
    onBonusReadyChange({
      exhausted: weeklyExhausted,
      availableCount: availableResetCredits.length,
    });
  }, [
    availableResetCredits.length,
    officialWeeklyLimit?.usedPercent,
    onBonusReadyChange,
    rateLimits,
    resetCredits,
    weeklyExhausted,
  ]);

  if (loading && !codexData && !rateLimits) {
    return (
      <div className="codex-panel">
        <div className="loading-state">{t("Loading Codex info...")}</div>
      </div>
    );
  }

  const hasRateLimits = Boolean(rateLimits?.primary || rateLimits?.secondary);
  const connected = rateLimits?.connected || codexData?.connected;
  const planType = rateLimits?.planType || codexData?.planType;
  const windows = buildCodexQuotaWindows(rateLimits);
  const showingStaleLimits = Boolean(rateLimitsError && hasRateLimits);
  const bonusGrantGroups = buildBonusGrantGroups(availableResetCredits);
  const officialWeeklyWindow = selectOfficialWeeklyWindow(rateLimits, weeklyQuota);
  const weeklyQuotaCheck = weeklyQuota
    ? checkWeeklyQuotaWindow(weeklyQuota, officialWeeklyWindow)
    : null;
  const displayedWeeklyQuota = weeklyQuotaCheck?.ok ? weeklyQuota : null;
  const displayedWeeklyQuotaError = isHardDisplayCheck(weeklyQuotaCheck)
    ? weeklyQuotaCheck.message
    : weeklyQuotaCheck?.ok
      ? null
      : weeklyQuotaError;
  const weeklyValueCheck = officialWeeklyLimit && weeklyValueEstimate
    ? checkWeeklyValueEstimate(weeklyValueEstimate, officialWeeklyLimit)
    : null;
  const displayedWeeklyValueEstimate = officialWeeklyLimit && weeklyValueEstimate && (
    weeklyValueCheck?.ok || isSoftDisplayCheck(weeklyValueCheck)
  )
    ? weeklyValueEstimate
    : null;
  const valueIsLastEstimate = isSoftDisplayCheck(weeklyValueCheck);
  const weeklyTokenCapacity = getWeeklyTokenCapacity(displayedWeeklyValueEstimate);
  const usesCommunityCapacity = weeklyTokenCapacity.source === 'community';
  const displayedWeeklyValueEstimateError = officialWeeklyLimit && !displayedWeeklyValueEstimate
    ? (isHardDisplayCheck(weeklyValueCheck) ? null : weeklyValueEstimateError)
    : null;
  const extrasObservedAt = [
    isSoftDisplayCheck(weeklyValueCheck) && weeklyValueEstimate
      ? Date.parse(weeklyValueEstimate.observedAt)
      : Number.NaN,
    isSoftDisplayCheck(weeklyQuotaCheck) && weeklyQuota
      ? Date.parse(weeklyQuota.observedAt)
      : Number.NaN,
  ].filter((value) => Number.isFinite(value));
  const extrasPausedCopy = extrasObservedAt.length > 0
    ? formatLocalExtrasPaused(Math.min(...extrasObservedAt))
    : null;
  const renderWeeklyPace = (window: CodexRateLimitWindow) => {
    if (weeklyExhausted) return null;
    if (window !== officialWeeklyWindow) return null;
    if (isSoftDisplayCheck(weeklyQuotaCheck)) return null;
    if (!displayedWeeklyQuota && displayedWeeklyQuotaError) {
      return (
        <span className="quota-pace warning">
          {t("Local pace unavailable:")}{" "}{displayedWeeklyQuotaError}
        </span>
      );
    }
    return null;
  };
  const exhaustedTip = weeklyExhausted
    ? getExhaustedWeekTip(formatResetAt(officialWeeklyLimit?.resetsAt), availableResetCredits.length)
    : null;
  const renderBonusPanel = () => {
    if (availableResetCredits.length === 0) return null;
    const body = (
      <>
        <div className="bonus-header">
          <div className="bonus-title-row">
            <span className="bonus-title">{t("Bonus resets")}</span>
            <span className="bonus-badge">{t("Bonus")}</span>
          </div>
          <span className="bonus-count">{availableResetCredits.length} {t("available")}</span>
        </div>
        <div className="bonus-grants">
          {bonusGrantGroups.map((group) => {
            const daysLeft = getDaysLeft(group.expiresAt);
            return (
              <div className="bonus-grant-row" key={group.key}>
                <span className="bonus-grant-left">
                  <span className="bonus-dot" />
                  <span className="bonus-grant-label">
                    +{group.count} {t("· Issued")}{" "}{formatGrantDate(group.grantedAt)}
                  </span>
                </span>
                <span className={`bonus-grant-right ${daysLeft != null && daysLeft <= 10 ? 'warning' : ''}`}>
                  {daysLeft == null ? t("Expiry unknown") : t("{p0} days left · {p1}", { p0: daysLeft, p1: formatGrantDate(group.expiresAt) })}
                </span>
              </div>
            );
          })}
        </div>
        <div className="bonus-note">{t("Occasional bonuses · No cap · Each valid for 30 days")}</div>
        {onOpenDashboard && (
          <div className="bonus-note">{t("Use in ChatGPT; QuotaBar cannot reset it for you.")}</div>
        )}
      </>
    );
    if (!onOpenDashboard) {
      return <div className="bonus-panel">{body}</div>;
    }
    return (
      <button
        type="button"
        className="bonus-panel bonus-panel-action"
        onClick={onOpenDashboard}
      >
        {body}
      </button>
    );
  };

  return (
    <div className="codex-panel">
      {error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">
            {localizeLabel(error)}
            {showingStaleLimits && <span className="error-context">{t("Showing last known data.")}</span>}
          </span>
        </div>
      )}

      {connected && (
        <div className="codex-content">
          {/* Rate Limits Section */}
          {hasRateLimits && (
            <div className="section">
              <div className="section-title">{t("Usage")}</div>

              <div className="quota-group">
                {rateLimits?.primary && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">
                        {formatWindowLabel(rateLimits.primary.windowMinutes, 'primary')}
                      </span>
                      <span className="quota-value">
                        {t("{p0}% remaining", { p0: remainingPercent(rateLimits.primary.usedPercent) })}</span>
                    </div>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-label={t("{p0} remaining quota", { p0: formatWindowLabel(rateLimits.primary.windowMinutes, 'primary') })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remainingPercent(rateLimits.primary.usedPercent)}
                      aria-valuetext={t("{p0}% remaining", { p0: remainingPercent(rateLimits.primary.usedPercent) })}
                    >
                      <div
                        className="progress-fill"
                        style={getRemainingProgressStyle(rateLimits.primary.usedPercent)}
                      />
                    </div>
                    {rateLimits.primary.resetsAt && (
                      <div className="reset-time">
                        <span>{t("Resets in")} {formatResetTime(rateLimits.primary.resetsAt)}</span>
                        <span>{formatResetAt(rateLimits.primary.resetsAt)}</span>
                      </div>
                    )}
                    {!weeklyExhausted && (() => {
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
                        {t("{p0}% remaining", { p0: remainingPercent(rateLimits.secondary.usedPercent) })}</span>
                    </div>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-label={t("{p0} remaining quota", { p0: formatWindowLabel(rateLimits.secondary.windowMinutes, 'secondary') })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remainingPercent(rateLimits.secondary.usedPercent)}
                      aria-valuetext={t("{p0}% remaining", { p0: remainingPercent(rateLimits.secondary.usedPercent) })}
                    >
                      <div
                        className="progress-fill"
                        style={getRemainingProgressStyle(rateLimits.secondary.usedPercent)}
                      />
                    </div>
                    {rateLimits.secondary.resetsAt && (
                      <div className="reset-time">
                        <span>{t("Resets in")} {formatResetTime(rateLimits.secondary.resetsAt)}</span>
                        <span>{formatResetAt(rateLimits.secondary.resetsAt)}</span>
                      </div>
                    )}
                    {renderWeeklyPace(rateLimits.secondary)}
                  </div>
                )}

                {rateLimits?.credits?.hasCredits && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">{t("Credits")}</span>
                      <span className="quota-value">
                        {rateLimits.credits.unlimited
                          ? t("Unlimited")
                          : rateLimits.credits.balance ?? 'n/a'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {weeklyExhausted && renderBonusPanel()}

          {officialWeeklyLimit && (
            <div className="section weekly-value-section">
              <div className="quota-group">
                <div className="quota-card weekly-value-card">
                  <div className="weekly-value-topline">
                    <span className="weekly-value-title">
                      <span className="weekly-value-dot" />
                      {t("Weekly token capacity")}
                    </span>
                    <span className="weekly-value-badge">
                      {usesCommunityCapacity ? t("Community reference") : valueIsLastEstimate ? t("Last estimate") : t("Local estimate")}
                    </span>
                  </div>
                  <div className="weekly-value-body">
                    <div className="weekly-value-metrics">
                      <div className="weekly-model-estimate">
                        <span>Astra</span>
                        <strong>{t("≈{tokens} tokens / week", { tokens: COMPACT_TOKEN_FORMAT().format(weeklyTokenCapacity.astraTokens) })}</strong>
                      </div>
                      <div className="weekly-model-estimate">
                        <span>GPT-5.6 Sol</span>
                        <strong>{t("≈{tokens} tokens / week", { tokens: COMPACT_TOKEN_FORMAT().format(weeklyTokenCapacity.solTokens) })}</strong>
                        {!usesCommunityCapacity && <small>{t("Price conversion from Astra · {ratio}× tokens", { ratio: weeklyReference.pricing.solTokensPerAstraToken })}</small>}
                      </div>
                    </div>
                    <div
                      className="weekly-value-gauge"
                      role="img"
                      aria-label={t("{p0}% remaining", { p0: remainingPercent(officialWeeklyLimit.usedPercent) })}
                      style={{
                        '--weekly-value-used': `${remainingPercent(officialWeeklyLimit.usedPercent)}%`,
                      } as CSSProperties}
                    >
                      <span className="weekly-value-gauge-center">
                        <strong>{remainingPercent(officialWeeklyLimit.usedPercent)}%</strong>
                        <small>{t("Remaining")}</small>
                      </span>
                    </div>
                  </div>
                  <div className="weekly-value-footer weekly-value-footer-basis">
                    <span>
                      {t("Same weekly quota · These alternatives cannot be added together")}
                    </span>
                    {usesCommunityCapacity && (
                      <>
                        <span>{t("Community sample · Pro 20× · Standard speed · Not your account's allowance")}</span>
                        <span>{weeklyReference.community.source} · {weeklyReference.community.snapshotAt.slice(0, 10)}</span>
                      </>
                    )}
                    <span>{t("Excludes GPT-Reserve complimentary usage")}</span>
                    {displayedWeeklyValueEstimate && (
                      <details className="weekly-value-diagnostic">
                        <summary>{t("API-equivalent week · current mix")}</summary>
                        <p>≈{USD_FORMAT().format(displayedWeeklyValueEstimate.estimatedWeeklyValueUsd)}</p>
                        <p>{t("Based on {p0}% remaining · {p1} local", { p0: remainingPercent(displayedWeeklyValueEstimate.usedPct), p1: USD_FORMAT().format(displayedWeeklyValueEstimate.observedCostUsd) })}</p>
                        <p>{t("Standard API prices · Not a bill")}</p>
                        <p>{valueIsLastEstimate
                          ? t("{p0} observed tokens · Not an official allowance · snapshot not refreshed", { p0: COMPACT_TOKEN_FORMAT().format(displayedWeeklyValueEstimate.observedTokens) })
                          : t("{p0} observed tokens · Not an official allowance", { p0: COMPACT_TOKEN_FORMAT().format(displayedWeeklyValueEstimate.observedTokens) })}</p>
                        {!usesCommunityCapacity && <p>{t("Astra-to-Sol conversion uses standard API prices checked on {date}; not a measured Sol quota.", { date: weeklyReference.pricing.checkedAt })}</p>}
                        <p>{t("Other devices, cloud usage and workload changes can skew the estimate.")}</p>
                      </details>
                    )}
                    {displayedWeeklyValueEstimateError && (
                      <details className="weekly-value-diagnostic">
                        <summary>{t("Diagnostics")}</summary>
                        <p className="quota-pace warning">
                        {displayedWeeklyValueEstimateError.unpricedModels
                          ? t("Weekly value unavailable because prices are missing for {models}.", { models: displayedWeeklyValueEstimateError.unpricedModels })
                          : t("Weekly value could not be calculated. See diagnostics for details.")}
                        </p>
                        <p>{displayedWeeklyValueEstimateError.diagnostic}</p>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {extrasPausedCopy && (
            <p className="codex-local-extras">{extrasPausedCopy}</p>
          )}

          {sections.tips && !error && (
            <SmartTip message={weeklyExhausted ? exhaustedTip : getHighUsageTip(windows)} />
          )}

          {!weeklyExhausted && renderBonusPanel()}

          {sections.timeline && <ResetTimeline windows={windows} />}

          {/* Subscription Section (only if no rate limits) */}
          {!hasRateLimits && codexData && (
            <div className="section">
              <div className="section-title">{t("Subscription")}</div>
              <div className="quota-group">
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">{t("Plan")}</span>
                    <span className="quota-value plan-badge">
                      {formatPlanType(planType)}
                    </span>
                  </div>
                </div>
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">{t("Valid Until")}</span>
                    <span className="quota-value">
                      {formatSubscriptionDate(codexData.subscriptionUntil)}
                    </span>
                  </div>
                </div>
                {codexData.email && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">{t("Account")}</span>
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
          <p>{t("Codex not connected")}</p>
          <p className="hint">{t("Run 'codex' in terminal to login")}</p>
        </div>
      )}
    </div>
  );
}

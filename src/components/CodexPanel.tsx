import { useEffect, useState, useCallback } from 'react';
import { backend } from '../services/backend';
import CostSummarySection from './CostSummarySection';
import ProviderDetailHeader from './ProviderDetailHeader';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type {
  CodexData,
  CodexRateLimits,
  CodexResetCredit,
  CodexResetCredits,
} from '../types/models';
import { buildCodexQuotaWindows, sortMostConstrained, type QuotaWindowSummary } from '../services/provider_summary';
import { getAvailableResetCredits, getHighUsageTip } from '../services/detail_helpers';
import { formatPaceText, formatPlanType, formatResetTime, getProgressStyle } from '../utils/quota_format';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request_generation = useLatestRequestGeneration();

  const fetchData = useCallback(async () => {
    const generation = request_generation.begin();
    try {
      setLoading(true);
      setError(null);

      const [info, limits, credits] = await Promise.all([
        backend.getCodexInfo(),
        backend.getCodexRateLimits(),
        backend.getCodexResetCredits(),
      ]);
      if (!request_generation.isCurrent(generation)) return;

      setCodexData(info);
      setRateLimits(limits);
      onQuotaWindowsChange?.(buildCodexQuotaWindows(limits));
      setResetCredits(credits);

      if (limits.error) {
        setError(limits.error);
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
      setError(err instanceof Error ? err.message : 'Failed to fetch Codex data');
      onConnectionChange?.(false);
      onUsageChange?.(null);
      onQuotaWindowsChange?.([]);
    } finally {
      if (request_generation.isCurrent(generation)) {
        setLoading(false);
      }
    }
  }, [onConnectionChange, onQuotaWindowsChange, onUsageChange, request_generation]);

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

  const hasRateLimits = rateLimits?.primary || rateLimits?.secondary;
  const connected = rateLimits?.connected || codexData?.connected;
  const planType = rateLimits?.planType || codexData?.planType;
  const windows = buildCodexQuotaWindows(rateLimits);
  const topWindow = sortMostConstrained(windows)[0];
  const availableResetCredits = getAvailableResetCredits(resetCredits);
  const bonusGrantGroups = buildBonusGrantGroups(availableResetCredits);

  return (
    <div className="codex-panel">
      {error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">{error}</span>
        </div>
      )}

      {connected && (
        <div className="codex-content">
          <ProviderDetailHeader
            service="codex"
            status={connected ? 'Connected' : 'Offline'}
            plan={formatCodexPlan(planType)}
            usedPercent={topWindow?.usedPercent ?? null}
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
                    <div className="progress-bar">
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
                    <div className="progress-bar">
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

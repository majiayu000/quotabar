import { useEffect, useState, useCallback } from 'react';
import { backend } from '../services/backend';
import type { CodexData, CodexRateLimits, CodexStats } from '../types/models';

interface CodexPanelProps {
  onConnectionChange?: (connected: boolean) => void;
  onUsageChange?: (usedPercent: number | null) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
}

function formatPlanType(planType?: string): string {
  if (!planType) return 'Unknown';
  return planType.charAt(0).toUpperCase() + planType.slice(1);
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

function formatWindowLabel(minutes?: number): string {
  if (!minutes) return 'Limit';
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    return days === 7 ? 'Weekly' : `${days}d`;
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  return `${minutes}m`;
}

function formatResetTime(resetAt?: number): string {
  if (!resetAt) return '';
  const date = new Date(resetAt * 1000);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return 'now';

  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
}

function getProgressColor(usedPercent: number): string {
  if (usedPercent >= 90) return '#ef4444';
  if (usedPercent >= 75) return '#f59e0b';
  return '#22c55e';
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
}: CodexPanelProps) {
  const [codexData, setCodexData] = useState<CodexData | null>(null);
  const [codexStats, setCodexStats] = useState<CodexStats | null>(null);
  const [rateLimits, setRateLimits] = useState<CodexRateLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [info, stats, limits] = await Promise.all([
        backend.getCodexInfo(),
        backend.getCodexStats(),
        backend.getCodexRateLimits(),
      ]);

      setCodexData(info);
      setCodexStats(stats);
      setRateLimits(limits);

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
      setError(err instanceof Error ? err.message : 'Failed to fetch Codex data');
      onConnectionChange?.(false);
      onUsageChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onConnectionChange, onUsageChange]);

  useEffect(() => {
    fetchData();
    // Refresh in background at configured interval.
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

  const handleOpenDashboard = async () => {
    try {
      await backend.openCodexDashboard();
    } catch (err) {
      console.error('Failed to open Codex dashboard:', err);
    }
  };

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
          {/* Rate Limits Section */}
          {hasRateLimits && (
            <div className="section">
              <div className="section-title">
                USAGE
                <span className="plan-tag">{formatPlanType(planType)}</span>
              </div>

              {rateLimits?.primary && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">
                      {formatWindowLabel(rateLimits.primary.windowMinutes)} limit
                    </span>
                    <span className="quota-value">
                      {Math.round(rateLimits.primary.usedPercent)}% used
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.min(Math.max(rateLimits.primary.usedPercent, 0), 100)}%`,
                        backgroundColor: getProgressColor(rateLimits.primary.usedPercent),
                      }}
                    />
                  </div>
                  {rateLimits.primary.resetsAt && (
                    <div className="reset-time">
                      Resets in {formatResetTime(rateLimits.primary.resetsAt)}
                    </div>
                  )}
                </div>
              )}

              {rateLimits?.secondary && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">
                      {formatWindowLabel(rateLimits.secondary.windowMinutes)} limit
                    </span>
                    <span className="quota-value">
                      {Math.round(rateLimits.secondary.usedPercent)}% used
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.min(Math.max(rateLimits.secondary.usedPercent, 0), 100)}%`,
                        backgroundColor: getProgressColor(rateLimits.secondary.usedPercent),
                      }}
                    />
                  </div>
                  {rateLimits.secondary.resetsAt && (
                    <div className="reset-time">
                      Resets in {formatResetTime(rateLimits.secondary.resetsAt)}
                    </div>
                  )}
                </div>
              )}

              {rateLimits?.credits?.hasCredits && (
                <div className="quota-card credits-card">
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
          )}

          {/* Subscription Section (only if no rate limits) */}
          {!hasRateLimits && codexData && (
            <div className="section">
              <div className="section-title">SUBSCRIPTION</div>
              <div className="codex-card">
                <div className="codex-row">
                  <span className="codex-label">Plan</span>
                  <span className="codex-value plan-badge">
                    {formatPlanType(planType)}
                  </span>
                </div>
                <div className="codex-row">
                  <span className="codex-label">Valid Until</span>
                  <span className="codex-value">
                    {formatSubscriptionDate(codexData.subscriptionUntil)}
                  </span>
                </div>
                {codexData.email && (
                  <div className="codex-row">
                    <span className="codex-label">Account</span>
                    <span className="codex-value email">{codexData.email}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Local Stats Section */}
          {codexStats && (codexStats.totalSessions > 0 || codexStats.todaySessions > 0) && (
            <div className="section">
              <div className="section-title">LOCAL STATS</div>
              <div className="codex-card">
                <div className="codex-row">
                  <span className="codex-label">Today</span>
                  <span className="codex-value">{codexStats.todaySessions} sessions</span>
                </div>
                <div className="codex-row">
                  <span className="codex-label">Total</span>
                  <span className="codex-value">{codexStats.totalSessions} sessions</span>
                </div>
              </div>
            </div>
          )}

          {/* ChatGPT Link */}
          <button className="open-dashboard-btn" onClick={handleOpenDashboard}>
            Open Dashboard
          </button>
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

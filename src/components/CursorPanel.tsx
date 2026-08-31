import { useEffect, useState, useCallback } from 'react';
import { useRef } from 'react';
import { backend } from '../services/backend';
import CostSummarySection from './CostSummarySection';
import ProviderDetailHeader from './ProviderDetailHeader';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type { CursorData } from '../types/models';
import { buildCursorQuotaWindows, sortMostConstrained, type QuotaWindowSummary } from '../services/provider_summary';
import { getHighUsageTip } from '../services/detail_helpers';
import { clampProgressValue, formatPlanType, getProgressStyle } from '../utils/quota_format';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';

interface CursorPanelProps {
  onConnectionChange?: (connected: boolean) => void;
  onUsageChange?: (usedPercent: number | null) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
  onQuotaWindowsChange?: (windows: QuotaWindowSummary[]) => void;
  showCostSummary?: boolean;
  sections?: PanelSectionVisibility;
}

function windowHint(label: string, onDemandEnabled?: boolean): string | undefined {
  if (label === 'Cursor Models') return 'Includes Cursor Grok and Composer';
  if (label === 'Other Models' && onDemandEnabled) {
    return 'Additional usage beyond limits consumes on-demand spend.';
  }
  return undefined;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatResetDate(resetAt?: string): string {
  if (!resetAt) return '';
  try {
    const date = new Date(resetAt);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    if (diff <= 0) return 'Resets soon';
    const days = Math.round(diff / (1000 * 60 * 60 * 24));
    if (days >= 2) return `Resets in ${days}d`;
    const hours = Math.round(diff / (1000 * 60 * 60));
    return `Resets in ${hours}h`;
  } catch {
    return '';
  }
}

export default function CursorPanel({
  onConnectionChange,
  onUsageChange,
  autoRefreshIntervalMs = 60 * 1000,
  manualRefreshNonce = 0,
  onLoadingChange,
  onQuotaWindowsChange,
  showCostSummary = true,
  sections = defaultPanelSections(),
}: CursorPanelProps) {
  const [cursorData, setCursorData] = useState<CursorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasResolvedData = useRef(false);
  const request_generation = useLatestRequestGeneration();

  const fetchData = useCallback(async () => {
    const generation = request_generation.begin();
    try {
      setLoading(true);
      setError(null);
      const data = await backend.getCursorInfo();
      if (!request_generation.isCurrent(generation)) return;
      setCursorData(data);
      hasResolvedData.current = true;
      if (data.error) {
        setError(data.error);
      }
      onConnectionChange?.(data.connected);
      onUsageChange?.(data.percentage ?? null);
      onQuotaWindowsChange?.(buildCursorQuotaWindows(data));
    } catch (err) {
      if (!request_generation.isCurrent(generation)) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch Cursor data';
      setError(message);
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
  }, [onConnectionChange, onQuotaWindowsChange, onUsageChange, request_generation]);

  useEffect(() => {
    fetchData();
    // 0 pauses background polling.
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

  if (loading && !cursorData) {
    return (
      <div className="codex-panel">
        <div className="loading-state">Loading Cursor info...</div>
      </div>
    );
  }

  const percentage = cursorData?.percentage ?? null;
  const resetLabel = formatResetDate(cursorData?.resetAt);
  const windows = buildCursorQuotaWindows(cursorData);
  const topWindow = sortMostConstrained(windows)[0];
  const hasDashboardWindows = cursorData?.autoPercent != null || cursorData?.apiPercent != null;
  const includedRequestValue = cursorData?.fastUsed != null && cursorData.fastLimit != null
    ? `${cursorData.fastUsed} / ${cursorData.fastLimit}${percentage != null ? ` · ${Math.round(percentage)}%` : ''}`
    : null;

  return (
    <div className="codex-panel">
      {error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">
            {error}
            {cursorData?.connected && <span className="error-context">Showing last known data.</span>}
          </span>
        </div>
      )}

      {cursorData?.connected && (
        <div className="codex-content">
          <ProviderDetailHeader
            service="cursor"
            status={error ? 'Stale data' : 'Connected'}
            plan={`Cursor ${formatPlanType(cursorData.planType, 'Unknown')}`}
            usedPercent={topWindow?.usedPercent ?? null}
            usageLabel={topWindow?.label}
            tone={error ? 'pending' : 'online'}
          />

          <div className="section">
            <div className="section-title">Usage</div>

            <div className="quota-group">
              {hasDashboardWindows && windows.map((window) => {
                const hint = windowHint(window.label, cursorData?.onDemandEnabled);
                return (
                  <div className="quota-card" key={window.label}>
                    <div className="quota-header">
                      <span className="quota-label">{window.label}</span>
                      <span className="quota-value">{`${Math.round(window.usedPercent)}% used`}</span>
                    </div>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-label={`${window.label} usage`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={clampProgressValue(window.usedPercent)}
                      aria-valuetext={`${Math.round(window.usedPercent)}% used`}
                    >
                      <div className="progress-fill" style={getProgressStyle(window.usedPercent)} />
                    </div>
                    {hint && <div className="reset-time">{hint}</div>}
                    {resetLabel && window.label === windows[0]?.label && (
                      <div className="reset-time">{resetLabel}</div>
                    )}
                  </div>
                );
              })}

              {!hasDashboardWindows && (includedRequestValue != null || percentage != null) && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">Usage</span>
                    <span className="quota-value">
                      {includedRequestValue ?? `${Math.round(percentage ?? 0)}% used`}
                    </span>
                  </div>
                  {percentage != null && (
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-label="Cursor usage"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={clampProgressValue(percentage)}
                      aria-valuetext={`${Math.round(percentage)}% used`}
                    >
                      <div className="progress-fill" style={getProgressStyle(percentage)} />
                    </div>
                  )}
                  {resetLabel && <div className="reset-time">{resetLabel}</div>}
                </div>
              )}

              {cursorData.onDemandUsedCents != null && cursorData.onDemandUsedCents > 0 && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">On-demand</span>
                    <span className="quota-value">{formatCents(cursorData.onDemandUsedCents)}</span>
                  </div>
                </div>
              )}

              {!hasDashboardWindows && !cursorData.onDemandEnabled && cursorData.slowUsed != null && cursorData.slowUsed > 0 && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">Slow requests</span>
                    <span className="quota-value">{cursorData.slowUsed}</span>
                  </div>
                </div>
              )}

            </div>

            {cursorData.email && (
              <div className="account-strip">
                <span className="account-strip-label">Account</span>
                <span className="account-strip-value" title={cursorData.email}>{cursorData.email}</span>
              </div>
            )}
          </div>

          {sections.tips && <SmartTip message={getHighUsageTip(windows)} />}

          {sections.timeline && <ResetTimeline windows={windows} />}

          {sections.cost && showCostSummary && (
            <CostSummarySection source="cursor" refreshKey={manualRefreshNonce} showTrend={sections.trend} />
          )}
        </div>
      )}

      {!cursorData?.connected && !error && (
        <div className="empty-state">
          <p>Cursor not connected</p>
          <p className="hint">Open Cursor and sign in, or set CURSOR_SESSION_TOKEN</p>
        </div>
      )}
    </div>
  );
}

import { localizeLabel, getLocale, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { useEffect, useState, useCallback } from 'react';
import { backend } from '../services/backend';
import CostSummarySection from './CostSummarySection';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type { CursorData } from '../types/models';
import { buildCursorQuotaWindows, getCursorTrayUsedPercent, type QuotaWindowSummary } from '../services/provider_summary';
import { getHighUsageTip } from '../services/detail_helpers';
import { remainingPercent, getRemainingProgressStyle } from '../utils/quota_format';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';

interface CursorPanelProps {
  onConnectionChange?: (connected: boolean) => void;
  onUsageChange?: (usedPercent: number | null) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
  onQuotaWindowsChange?: (windows: QuotaWindowSummary[]) => void;
  onReadResult?: (error: string | null) => void;
  showCostSummary?: boolean;
  sections?: PanelSectionVisibility;
}

function windowHint(label: string, onDemandEnabled?: boolean): string | undefined {
  if (label === 'Cursor Models') return t("Includes Cursor Grok and Composer");
  if (label === 'Other Models' && onDemandEnabled) {
    return t("Usage beyond the quota incurs on-demand charges.");
  }
  return undefined;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat(getLocale(), {
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
    if (diff <= 0) return t("Resetting soon");
    const days = Math.round(diff / (1000 * 60 * 60 * 24));
    if (days >= 2) return t("Resets in {p0} days", { p0: days });
    const hours = Math.round(diff / (1000 * 60 * 60));
    return t("Resets in {p0} hours", { p0: hours });
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
  onReadResult,
  showCostSummary = true,
  sections = defaultPanelSections(),
}: CursorPanelProps) {
  useLocale();
  const [cursorData, setCursorData] = useState<CursorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request_generation = useLatestRequestGeneration();


  const fetchData = useCallback(async (manual = false) => {
    const generation = request_generation.begin();
    try {
      setLoading(true);
      setError(null);
      const data = await backend.getCursorInfo(manual);
      if (!request_generation.isCurrent(generation)) return;
      setCursorData(data);
      if (data.error) {
        setError(data.error);
      }
      onConnectionChange?.(data.connected);
      onUsageChange?.(getCursorTrayUsedPercent(data));
      onQuotaWindowsChange?.(buildCursorQuotaWindows(data));
      onReadResult?.(data.error ?? (data.connected && buildCursorQuotaWindows(data).length > 0 ? null : t("Quota unavailable")));
    } catch (err) {
      if (!request_generation.isCurrent(generation)) return;
      const message = err instanceof Error ? err.message : "Failed to fetch Cursor data";
      setError(message);
      onReadResult?.(message);
      onConnectionChange?.(false);
      onUsageChange?.(null);
      onQuotaWindowsChange?.([]);
    } finally {
      if (request_generation.isCurrent(generation)) {
        setLoading(false);
      }
    }
  }, [onConnectionChange, onQuotaWindowsChange, onReadResult, onUsageChange, request_generation]);

  useEffect(() => {
    void fetchData();
    // 0 pauses background polling.
    if (autoRefreshIntervalMs <= 0) return;
    const interval = setInterval(() => {
      void fetchData();
    }, autoRefreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, autoRefreshIntervalMs]);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (manualRefreshNonce > 0) {
      void fetchData(true);
    }
  }, [manualRefreshNonce, fetchData]);

  if (loading && !cursorData) {
    return (
      <div className="codex-panel">
        <div className="loading-state">{t("Loading Cursor info...")}</div>
      </div>
    );
  }

  const percentage = cursorData?.percentage ?? null;
  const resetLabel = formatResetDate(cursorData?.resetAt);
  const windows = buildCursorQuotaWindows(cursorData);
  const hasDashboardWindows = cursorData?.autoPercent != null || cursorData?.apiPercent != null;
  const includedRequestValue = cursorData?.fastUsed != null && cursorData.fastLimit != null
    ? t("Remaining {p0} / {p1}{p2}", { p0: Math.max(0, cursorData.fastLimit - cursorData.fastUsed), p1: cursorData.fastLimit, p2: percentage != null ? ` · ${remainingPercent(percentage)}%` : '' })
    : null;

  return (
    <div className="codex-panel">
      {error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">
            {localizeLabel(error)}
            {cursorData?.connected && <span className="error-context">{t("Showing last known data.")}</span>}
          </span>
        </div>
      )}

      {cursorData?.connected && (
        <div className="codex-content">
          <div className="section">
            <div className="section-title">{t("Usage")}</div>

            <div className="quota-group">
              {hasDashboardWindows && windows.map((window) => {
                const hint = windowHint(window.label, cursorData?.onDemandEnabled);
                return (
                  <div className="quota-card" key={localizeLabel(window.label)}>
                    <div className="quota-header">
                      <span className="quota-label">{localizeLabel(window.label)}</span>
                      <span className="quota-value">{t("{p0}% remaining", { p0: remainingPercent(window.usedPercent) })}</span>
                    </div>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-label={t("{p0} remaining quota", { p0: localizeLabel(window.label) })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remainingPercent(window.usedPercent)}
                      aria-valuetext={t("{p0}% remaining", { p0: remainingPercent(window.usedPercent) })}
                    >
                      <div className="progress-fill" style={getRemainingProgressStyle(window.usedPercent)} />
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
                    <span className="quota-label">{t("Usage")}</span>
                    <span className="quota-value">
                      {includedRequestValue ?? t("{p0}% remaining", { p0: remainingPercent(percentage ?? 0) })}
                    </span>
                  </div>
                  {percentage != null && (
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-label={t("Cursor remaining quota")}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remainingPercent(percentage)}
                      aria-valuetext={t("{p0}% remaining", { p0: remainingPercent(percentage) })}
                    >
                      <div className="progress-fill" style={getRemainingProgressStyle(percentage)} />
                    </div>
                  )}
                  {resetLabel && <div className="reset-time">{resetLabel}</div>}
                </div>
              )}

              {cursorData.onDemandUsedCents != null && cursorData.onDemandUsedCents > 0 && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">{t("On-demand")}</span>
                    <span className="quota-value">{formatCents(cursorData.onDemandUsedCents)}</span>
                  </div>
                </div>
              )}

              {!hasDashboardWindows && !cursorData.onDemandEnabled && cursorData.slowUsed != null && cursorData.slowUsed > 0 && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">{t("Slow requests")}</span>
                    <span className="quota-value">{cursorData.slowUsed}</span>
                  </div>
                </div>
              )}

            </div>

            {cursorData.email && (
              <div className="account-strip">
                <span className="account-strip-label">{t("Account")}</span>
                <span className="account-strip-value" title={cursorData.email}>{cursorData.email}</span>
              </div>
            )}
          </div>

          {sections.tips && !error && <SmartTip message={getHighUsageTip(windows)} />}

          {sections.timeline && <ResetTimeline windows={windows} />}

          {sections.cost && showCostSummary && (
            <CostSummarySection source="cursor" refreshKey={manualRefreshNonce} showTrend={sections.trend} />
          )}
        </div>
      )}

      {!cursorData?.connected && !error && (
        <div className="empty-state">
          <p>{t("Cursor not connected")}</p>
          <p className="hint">{t("Open Cursor and sign in, or set CURSOR_SESSION_TOKEN")}</p>
        </div>
      )}
    </div>
  );
}

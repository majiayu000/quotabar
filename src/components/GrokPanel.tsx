import { useEffect, useState, useCallback } from 'react';
import { backend } from '../services/backend';
import ProviderDetailHeader from './ProviderDetailHeader';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type { GrokData } from '../types/models';
import { buildGrokQuotaWindows, sortMostConstrained, type QuotaWindowSummary } from '../services/provider_summary';
import { getHighUsageTip } from '../services/detail_helpers';
import { formatResetTime, getProgressStyle } from '../utils/quota_format';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';

interface GrokPanelProps {
  onConnectionChange?: (connected: boolean) => void;
  onUsageChange?: (usedPercent: number | null) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
  onQuotaWindowsChange?: (windows: QuotaWindowSummary[]) => void;
  sections?: PanelSectionVisibility;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function poolLabel(data: GrokData): string {
  return data.periodLabel ? `${data.periodLabel} pool` : 'Usage pool';
}

export default function GrokPanel({
  onConnectionChange,
  onUsageChange,
  autoRefreshIntervalMs = 60 * 1000,
  manualRefreshNonce = 0,
  onLoadingChange,
  onQuotaWindowsChange,
  sections = defaultPanelSections(),
}: GrokPanelProps) {
  const [grokData, setGrokData] = useState<GrokData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request_generation = useLatestRequestGeneration();

  const fetchData = useCallback(async () => {
    const generation = request_generation.begin();
    try {
      setLoading(true);
      setError(null);
      const data = await backend.getGrokInfo();
      if (!request_generation.isCurrent(generation)) return;
      setGrokData(data);
      if (data.error) {
        setError(data.error);
      }
      onConnectionChange?.(data.connected);
      onUsageChange?.(data.percentage ?? null);
      onQuotaWindowsChange?.(buildGrokQuotaWindows(data));
    } catch (err) {
      if (!request_generation.isCurrent(generation)) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch Grok data';
      setError(message);
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

  if (loading && !grokData) {
    return (
      <div className="codex-panel">
        <div className="loading-state">Loading Grok info...</div>
      </div>
    );
  }

  const percentage = grokData?.percentage ?? null;
  const windows = buildGrokQuotaWindows(grokData);
  const topWindow = sortMostConstrained(windows)[0];
  const extra = grokData?.extra;
  const products = grokData?.products ?? [];
  const resetLabel = grokData?.resetAt
    ? formatResetTime(grokData.resetAt, { expiredLabel: 'soon' })
    : '';

  return (
    <div className="codex-panel">
      {error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">{error}</span>
        </div>
      )}

      {grokData?.connected && (
        <div className="codex-content">
          <ProviderDetailHeader
            service="grok"
            status="Connected"
            plan={grokData.planType || 'Grok'}
            usedPercent={topWindow?.usedPercent ?? null}
          />

          <div className="section">
            <div className="section-title">Usage</div>
            <div className="quota-group">
              {percentage != null && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">{poolLabel(grokData)}</span>
                    <span className="quota-value">{`${Math.round(percentage)}%`}</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={getProgressStyle(percentage)} />
                  </div>
                  {resetLabel && <div className="reset-time">Resets in {resetLabel}</div>}
                </div>
              )}

              {grokData.email && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">Account</span>
                    <span className="quota-value email">{grokData.email}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {products.length > 0 && (
            <div className="section">
              <div className="section-title">By product</div>
              <div className="quota-group">
                {products.map((product) => (
                  <div className="quota-card" key={product.product}>
                    <div className="quota-header">
                      <span className="quota-label">{product.label}</span>
                      <span className="quota-value">{`${Math.round(product.usagePercent)}%`}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={getProgressStyle(product.usagePercent)} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
                Share of the same {grokData.periodLabel?.toLowerCase() ?? 'usage'} pool, not a separate limit.
              </p>
            </div>
          )}

          {extra && (
            <div className="section">
              <div className="section-title">Extra credits</div>
              <div className="quota-group">
                {extra.onDemandCapCents > 0 && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">On-demand</span>
                      <span className="quota-value">
                        {`${formatCents(extra.onDemandUsedCents)} / ${formatCents(extra.onDemandCapCents)}`}
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={getProgressStyle(
                          Math.min(100, (extra.onDemandUsedCents / extra.onDemandCapCents) * 100),
                        )}
                      />
                    </div>
                  </div>
                )}
                {extra.prepaidBalanceCents > 0 && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">Prepaid remaining</span>
                      <span className="quota-value">{formatCents(extra.prepaidBalanceCents)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {sections.tips && <SmartTip message={getHighUsageTip(windows)} />}
          {sections.timeline && <ResetTimeline windows={windows} />}
        </div>
      )}

      {!grokData?.connected && !error && (
        <div className="empty-state">
          <p>Grok not connected</p>
          <p className="hint">Run grok login, then click Refresh</p>
        </div>
      )}
    </div>
  );
}

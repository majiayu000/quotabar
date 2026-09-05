import { workspaceCopy } from '../utils/quota_format';
import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { backend } from '../services/backend';
import QuotaRecovery from './QuotaRecovery';
import ProviderDetailHeader from './ProviderDetailHeader';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type { GrokData } from '../types/models';
import { buildGrokQuotaWindows, sortMostConstrained, type QuotaWindowSummary } from '../services/provider_summary';
import { getHighUsageTip } from '../services/detail_helpers';
import { formatResetTime, getProgressStyle } from '../utils/quota_format';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';
import { validateGrokValueEstimate } from '../services/grok_value_estimate';

interface GrokPanelProps {
  workspace?: boolean;
  onConnectionChange?: (connected: boolean) => void;
  onUsageChange?: (usedPercent: number | null) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
  onQuotaWindowsChange?: (windows: QuotaWindowSummary[]) => void;
  onReadResult?: (error: string | null) => void;
  sections?: PanelSectionVisibility;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function poolLabel(data: GrokData): string {
  return data.periodLabel ? `${data.periodLabel} pool` : 'Usage pool';
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

function periodValueTitle(periodType?: string): string {
  if (periodType === 'monthly') return 'API-equivalent month';
  if (periodType === 'weekly') return 'API-equivalent week';
  return 'API-equivalent period';
}

export default function GrokPanel({
  workspace = false,
  onConnectionChange,
  onUsageChange,
  autoRefreshIntervalMs = 60 * 1000,
  manualRefreshNonce = 0,
  onLoadingChange,
  onQuotaWindowsChange,
  onReadResult,
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
      onReadResult?.(data.error ?? null);
    } catch (err) {
      if (!request_generation.isCurrent(generation)) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch Grok data';
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

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (autoRefreshIntervalMs <= 0 || !grokData?.connected || error) return;
    const interval = setInterval(fetchData, autoRefreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, autoRefreshIntervalMs, grokData?.connected, error]);

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
  const grokValueValidationError = grokData && grokData.valueEstimate
    ? validateGrokValueEstimate(grokData.valueEstimate)
    : null;
  const displayedGrokValueEstimate = grokValueValidationError
    ? null
    : grokData?.valueEstimate ?? null;
  const displayedGrokValueEstimateError = grokValueValidationError
    ?? grokData?.valueEstimateError
    ?? null;

  return (
    <div className="codex-panel">
      {error && (workspace ? <QuotaRecovery provider="grok" read={{ error, readAt: null }} hasData={Boolean(grokData?.connected)} /> :
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
            <div className="section-title">{workspaceCopy("Usage", "额度用量")}</div>
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
                    <span className="quota-label">{workspaceCopy("Account", "账户")}</span>
                    <span className="quota-value email">{grokData.email}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {(displayedGrokValueEstimate || displayedGrokValueEstimateError) && (
            <div className="section weekly-value-section">
              <div className="quota-group">
                <div className="quota-card weekly-value-card">
                  {displayedGrokValueEstimate ? (
                    <>
                      <div className="weekly-value-topline">
                        <span className="weekly-value-title">
                          <span className="weekly-value-dot" />
                          {periodValueTitle(grokData.periodType)}
                        </span>
                        <span className="weekly-value-badge">Local estimate</span>
                      </div>
                      <div className="weekly-value-body">
                        <div className="weekly-value-metrics">
                          <span className="weekly-value-amount">
                          ≈{USD_FORMAT.format(displayedGrokValueEstimate.observedCostUsd)}
                          </span>
                          <span className="weekly-value-token-row">
                            <strong>
                              ≈{COMPACT_TOKEN_FORMAT.format(displayedGrokValueEstimate.observedTokens)}
                            </strong>
                            <span>billed so far this period</span>
                          </span>
                          <span className="weekly-value-token-row">
                            <span>Full pool</span>
                            <strong>
                              ≈{USD_FORMAT.format(displayedGrokValueEstimate.estimatedPeriodValueUsd)}
                            </strong>
                          </span>
                        </div>
                        <div
                          className="weekly-value-gauge"
                          role="img"
                          aria-label={`Estimate based on ${Math.round(displayedGrokValueEstimate.usedPct)}% used`}
                          style={{
                            '--weekly-value-used': `${Math.min(Math.max(displayedGrokValueEstimate.usedPct, 0), 100)}%`,
                          } as CSSProperties}
                        >
                          <span className="weekly-value-gauge-center">
                            <strong>{Math.round(displayedGrokValueEstimate.usedPct)}%</strong>
                            <small>used</small>
                          </span>
                        </div>
                      </div>
                      <div className="weekly-value-footer">
                        <span>Projected from local Grok usage</span>
                        <span>Not an official allowance</span>
                      </div>
                    </>
                  ) : (
                    <span className="quota-pace warning">
                      Pool value unavailable: {displayedGrokValueEstimateError}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

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

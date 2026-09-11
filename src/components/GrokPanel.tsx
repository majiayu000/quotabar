import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { backend } from '../services/backend';
import QuotaRecovery from './QuotaRecovery';
import ResetTimeline from './ResetTimeline';
import SmartTip from './SmartTip';
import type { GrokData } from '../types/models';
import { buildGrokQuotaWindows, grokPoolWindowLabel, type QuotaWindowSummary } from '../services/provider_summary';
import { getHighUsageTip } from '../services/detail_helpers';
import { formatResetTime, getProgressStyle, workspaceCopy } from '../utils/quota_format';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';
import { validateGrokValueEstimate, grokCoverageLabel } from '../services/grok_value_estimate';

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
  return grokPoolWindowLabel(data);
}

function grokProductUsagePercent(usagePercent: number | null | undefined): number | null {
  return typeof usagePercent === 'number' && Number.isFinite(usagePercent)
    ? usagePercent
    : null;
}

function grokExtraCents(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function grokScaleBasisCopy(estimate: { scaleProduct?: string; scaleUsedPct?: number }): string | null {
  if (estimate.scaleProduct !== 'build') return null;
  if (typeof estimate.scaleUsedPct !== 'number' || !Number.isFinite(estimate.scaleUsedPct)) {
    return null;
  }
  return workspaceCopy(
    `Full pool dollars are extrapolated from Build ${Math.round(estimate.scaleUsedPct)}%, not from the pool gauge percent.`,
    `整池金额按 Build ${Math.round(estimate.scaleUsedPct)}% 外推，不是按总池百分比`,
  );
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
  if (periodType === 'monthly') return workspaceCopy('Monthly API-equivalent estimate', '每月 API 等价估算');
  if (periodType === 'weekly') return workspaceCopy('Weekly API-equivalent estimate', '每周 API 等价估算');
  return workspaceCopy('Period API-equivalent estimate', '周期 API 等价估算');
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

  const fetchData = useCallback(async (manual = false) => {
    const generation = request_generation.begin();
    try {
      setLoading(true);
      setError(null);
      const data = await backend.getGrokInfo(manual);
      if (!request_generation.isCurrent(generation)) return;
      setGrokData(data);
      if (data.error) {
        setError(data.error);
      }
      onConnectionChange?.(data.connected);
      onUsageChange?.(data.percentage ?? null);
      onQuotaWindowsChange?.(buildGrokQuotaWindows(data));
      onReadResult?.(data.error ?? (data.connected && buildGrokQuotaWindows(data).length > 0 ? null : 'Quota unavailable'));
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
      void fetchData(true);
    }
  }, [manualRefreshNonce, fetchData]);

  if (loading && !grokData) {
    return (
      <div className="codex-panel">
        <div className="loading-state">{workspaceCopy('Loading Grok info...', '正在读取 Grok…')}</div>
      </div>
    );
  }

  const percentage = grokData?.percentage ?? null;
  const windows = buildGrokQuotaWindows(grokData);
  const extra = grokData?.extra;
  const extraUsedCents = grokExtraCents(extra?.onDemandUsedCents);
  const extraCapCents = grokExtraCents(extra?.onDemandCapCents);
  const extraPrepaidCents = grokExtraCents(extra?.prepaidBalanceCents);
  const products = (grokData?.products ?? []).filter(
    (product) => grokProductUsagePercent(product.usagePercent) != null,
  );
  const resetLabel = grokData?.resetAt
    ? formatResetTime(grokData.resetAt, { expiredLabel: workspaceCopy('soon', '即将重置') })
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
  const grokCoverageNote = displayedGrokValueEstimate
    ? grokCoverageLabel(displayedGrokValueEstimate)
    : null;
  const grokCostPrefix = displayedGrokValueEstimate?.costIsLowerBound ? '≥' : '≈';

  return (
    <div className="codex-panel">
      {error && (workspace ? <QuotaRecovery provider="grok" read={{ error, readAt: null }} hasData={Boolean(grokData?.connected)} /> :
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">{error}{grokData?.connected && <span className="error-context">当前显示上次成功读取的数据。</span>}</span>
        </div>
      )}

      {grokData?.connected && (
        <div className="codex-content">
          <div className="section">
            <div className="section-title">{workspaceCopy("Usage", "额度用量")}</div>
            <div className="quota-group">
              {percentage != null && (
                <div className="quota-card">
                  <div className="quota-header">
                    <span className="quota-label">{poolLabel(grokData)}</span>
                    <span className="quota-value">{`${Math.round(percentage)}% 已用`}</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={getProgressStyle(percentage)} />
                  </div>
                  {resetLabel && (
                    <div className="reset-time">
                      {workspaceCopy('Resets in', '重置倒计时')} {resetLabel}
                    </div>
                  )}
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
                        <span className="weekly-value-badge">{workspaceCopy('Local estimate', '本地估算')}</span>
                      </div>
                      <div className="weekly-value-body">
                        <div className="weekly-value-metrics">
                          <span className="weekly-value-amount">
                          {grokCostPrefix}{USD_FORMAT.format(displayedGrokValueEstimate.observedCostUsd)}
                          </span>
                          <span className="weekly-value-token-row">
                            <strong>
                              {grokCostPrefix}{COMPACT_TOKEN_FORMAT.format(displayedGrokValueEstimate.observedTokens)}
                            </strong>
                            <span>{workspaceCopy('billed so far this period', '本周期已计入')}</span>
                          </span>
                          <span className="weekly-value-token-row">
                            <span>{workspaceCopy('Full pool', '整池估值')}</span>
                            <strong>
                              {grokCostPrefix}{USD_FORMAT.format(displayedGrokValueEstimate.estimatedPeriodValueUsd)}
                            </strong>
                          </span>
                          {grokCoverageNote ? (
                            <span className="weekly-value-token-row">
                              {grokCoverageNote}
                            </span>
                          ) : null}
                          {grokScaleBasisCopy(displayedGrokValueEstimate) ? (
                            <span className="weekly-value-token-row">
                              {grokScaleBasisCopy(displayedGrokValueEstimate)}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className="weekly-value-gauge"
                          role="img"
                          aria-label={workspaceCopy(
                            `Estimate based on ${Math.round(displayedGrokValueEstimate.usedPct)}% used`,
                            `按 ${Math.round(displayedGrokValueEstimate.usedPct)}% 已用估算`,
                          )}
                          style={{
                            '--weekly-value-used': `${Math.min(Math.max(displayedGrokValueEstimate.usedPct, 0), 100)}%`,
                          } as CSSProperties}
                        >
                          <span className="weekly-value-gauge-center">
                            <strong>{Math.round(displayedGrokValueEstimate.usedPct)}%</strong>
                            <small>已用</small>
                          </span>
                        </div>
                      </div>
                      <div className="weekly-value-footer">
                        <span>{workspaceCopy('Projected from local Grok usage', '按本机 Grok 用量推算')}</span>
                        <span>{workspaceCopy('API-price estimate · Not your bill', '按 API 价格估算 · 不代表账单')}</span>
                      </div>
                    </>
                  ) : (
                    <span className="quota-pace warning">
                      {workspaceCopy('Pool value unavailable', '整池估值不可用')}: {displayedGrokValueEstimateError}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {products.length > 0 && (
            <div className="section">
              <div className="section-title">{workspaceCopy('Product share of the pool', '共享额度的产品份额')}</div>
              <div className="quota-group">
                {products.map((product) => {
                  const usagePercent = grokProductUsagePercent(product.usagePercent);
                  if (usagePercent == null) return null;
                  return (
                    <div className="quota-card" key={product.product}>
                      <div className="quota-header">
                        <span className="quota-label">{product.label}</span>
                        <span className="quota-value">{`${Math.round(usagePercent)}% 已用`}</span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={getProgressStyle(usagePercent)} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="hint" style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
                {workspaceCopy(
                  'Share of the same usage pool, not a separate limit.',
                  '占用同一额度池的份额，不是单独限额。',
                )}
              </p>
            </div>
          )}

          {extraUsedCents != null && extraCapCents != null && extraPrepaidCents != null && (
            <div className="section">
              <div className="section-title">{workspaceCopy('Extra credits', '额外额度')}</div>
              <div className="quota-group">
                {extraCapCents > 0 && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">{workspaceCopy('On-demand', '按需')}</span>
                      <span className="quota-value">
                        {`${formatCents(extraUsedCents)} / ${formatCents(extraCapCents)}`}
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={getProgressStyle(
                          Math.min(100, (extraUsedCents / extraCapCents) * 100),
                        )}
                      />
                    </div>
                  </div>
                )}
                {extraPrepaidCents > 0 && (
                  <div className="quota-card">
                    <div className="quota-header">
                      <span className="quota-label">{workspaceCopy('Prepaid remaining', '预付余额')}</span>
                      <span className="quota-value">{formatCents(extraPrepaidCents)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {sections.tips && !error && <SmartTip message={getHighUsageTip(windows)} />}
          {sections.timeline && <ResetTimeline windows={windows} />}
        </div>
      )}

      {!grokData?.connected && !error && (
        <div className="empty-state">
          <p>{workspaceCopy('Grok not connected', '未连接 Grok')}</p>
          <p className="hint">{workspaceCopy('Run grok login, then click Refresh', '请先运行 grok login，再点 Refresh')}</p>
        </div>
      )}
    </div>
  );
}

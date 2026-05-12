import { useEffect, useMemo, useState } from 'react';
import { backend } from '../services/backend';
import type { CostOverview, CostRangeSummary, CostSource } from '../types/models';

interface CostSummarySectionProps {
  source: CostSource;
  refreshKey?: number;
}

function formatMoney(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';

  const maximumFractionDigits = Math.abs(value) < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(maximumFractionDigits)}`;
  }
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUpdatedAt(value: string): string {
  try {
    return new Date(value).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function pickPrimaryRange(overview: CostOverview | null): CostRangeSummary | null {
  if (!overview) return null;
  return (
    overview.ranges.find((range) => range.range === 'today' && range.validEntries > 0) ??
    overview.ranges.find((range) => range.validEntries > 0) ??
    overview.ranges[0] ??
    null
  );
}

export default function CostSummarySection({ source, refreshKey = 0 }: CostSummarySectionProps) {
  const [overview, setOverview] = useState<CostOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCost = async (force: boolean) => {
      try {
        setLoading(true);
        setError(null);
        const data = await backend.getCostOverview(source, force);
        if (!cancelled) {
          setOverview(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load cost summary');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadCost(refreshKey > 0);
    const interval = setInterval(() => loadCost(false), 300_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [source, refreshKey]);

  const primaryRange = useMemo(() => pickPrimaryRange(overview), [overview]);
  const topModels = primaryRange?.models.slice(0, 3) ?? [];
  const currency = overview?.currency ?? 'USD';

  return (
    <div className="section cost-section">
      <div className="section-title">
        LOCAL COST
        {overview && (
          <span className="plan-tag">{overview.cached ? 'cached' : currency}</span>
        )}
      </div>

      {loading && !overview && (
        <div className="cost-loading">Loading cost...</div>
      )}

      {error && !overview && (
        <div className="cost-inline-error">{error}</div>
      )}

      {overview && (
        <div className="cost-card">
          <div className="cost-range-grid">
            {overview.ranges.map((range) => (
              <div
                className={`cost-range ${range.range === primaryRange?.range ? 'active' : ''}`}
                key={range.range}
              >
                <span className="cost-range-label">{range.label}</span>
                <strong className="cost-range-value">
                  {formatMoney(range.cost, range.currency)}
                </strong>
              </div>
            ))}
          </div>

          {primaryRange && (
            <>
              <div className="cost-detail-grid">
                <div className="cost-detail">
                  <span className="cost-detail-label">Tokens</span>
                  <strong className="cost-detail-value">
                    {formatCompactNumber(primaryRange.tokens.totalTokens)}
                  </strong>
                </div>
                <div className="cost-detail">
                  <span className="cost-detail-label">Entries</span>
                  <strong className="cost-detail-value">
                    {formatCompactNumber(primaryRange.validEntries)}
                  </strong>
                </div>
                <div className="cost-detail">
                  <span className="cost-detail-label">Input</span>
                  <strong className="cost-detail-value">
                    {formatCompactNumber(primaryRange.tokens.inputTokens)}
                  </strong>
                </div>
                <div className="cost-detail">
                  <span className="cost-detail-label">Output</span>
                  <strong className="cost-detail-value">
                    {formatCompactNumber(primaryRange.tokens.outputTokens)}
                  </strong>
                </div>
              </div>

              {topModels.length > 0 && (
                <div className="cost-models">
                  {topModels.map((model) => (
                    <div className="cost-model-row" key={model.model}>
                      <span className="cost-model-name">{model.model}</span>
                      <span className="cost-model-tokens">
                        {formatCompactNumber(model.tokens.totalTokens)}
                      </span>
                      <span className="cost-model-cost">
                        {formatMoney(model.cost, primaryRange.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="cost-footer">
            <span>{primaryRange?.label ?? overview.displayName}</span>
            <span>{formatUpdatedAt(overview.generatedAt)}</span>
          </div>

          {error && <div className="cost-inline-error compact">{error}</div>}
        </div>
      )}
    </div>
  );
}

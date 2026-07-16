import { useEffect, useMemo, useState } from 'react';
import { backend } from '../services/backend';
import { getBudgetForSources, getSavedMonthlyBudgets } from '../services/budget';
import type { CostDailyPoint, CostDailySeries, CostOverview, CostRangeSummary, CostSource } from '../types/models';
import { getProgressStyle } from '../utils/quota_format';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';

interface CostSummarySectionProps {
  source: CostSource | readonly CostSource[];
  refreshKey?: number;
  autoRefreshIntervalMs?: number;
  showTrend?: boolean;
}

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_SERIES_DAYS = 30;

export type SparkRange = '7d' | '30d';

export function mergeDailySeries(seriesList: CostDailySeries[]): CostDailyPoint[] {
  const byDate = new Map<string, CostDailyPoint>();
  for (const series of seriesList) {
    for (const day of series.days) {
      const existing = byDate.get(day.date);
      if (!existing) {
        byDate.set(day.date, { ...day });
        continue;
      }
      existing.cost = sumNullable([existing.cost, day.cost]);
      existing.costUsd = sumNullable([existing.costUsd, day.costUsd]);
      existing.totalTokens += day.totalTokens;
    }
  }
  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
}

export function sliceSparkDays(days: CostDailyPoint[], range: SparkRange): CostDailyPoint[] {
  return range === '7d' ? days.slice(-7) : days.slice(-30);
}

export function sumDailyCost(days: CostDailyPoint[]): number {
  return days.reduce((total, day) => total + (day.costUsd ?? day.cost ?? 0), 0);
}

export function startCostSummaryAutoRefresh(
  autoRefreshIntervalMs: number,
  loadCost: (force: boolean) => void | Promise<void>,
): ReturnType<typeof setInterval> | undefined {
  if (autoRefreshIntervalMs <= 0) return undefined;
  return setInterval(() => {
    void loadCost(true);
  }, autoRefreshIntervalMs);
}

export function getCostSummaryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = err.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Failed to load cost summary';
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

function formatCostNote(range: CostRangeSummary | null): string {
  if (!range) return '';
  return `${formatCompactNumber(range.tokens.totalTokens)} tokens`;
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

function emptyTokens() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };
}

function addTokens(left: ReturnType<typeof emptyTokens>, right: CostRangeSummary['tokens']) {
  left.inputTokens += right.inputTokens;
  left.outputTokens += right.outputTokens;
  left.reasoningTokens += right.reasoningTokens;
  left.cacheCreationTokens += right.cacheCreationTokens;
  left.cacheReadTokens += right.cacheReadTokens;
  left.totalTokens += right.totalTokens;
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : null;
}

function latestTimestamp(values: string[]): string {
  return values.reduce((latest, value) => {
    const latestTime = Date.parse(latest);
    const valueTime = Date.parse(value);
    return Number.isFinite(valueTime) && valueTime > latestTime ? value : latest;
  });
}

function mergeCostOverviews(overviews: CostOverview[]): CostOverview {
  if (overviews.length === 1) return overviews[0];

  const rangeOrder = overviews[0]?.ranges.map((range) => range.range) ?? [];
  const ranges = rangeOrder.map((rangeName) => {
    const matching = overviews
      .map((overview) => overview.ranges.find((range) => range.range === rangeName))
      .filter((range): range is CostRangeSummary => Boolean(range));
    const first = matching[0];
    const tokens = emptyTokens();
    const modelMap = new Map<string, CostRangeSummary['models'][number]>();

    for (const range of matching) {
      addTokens(tokens, range.tokens);
      for (const model of range.models) {
        const existing = modelMap.get(model.model);
        if (!existing) {
          modelMap.set(model.model, { ...model, tokens: { ...model.tokens } });
          continue;
        }
        existing.cost = sumNullable([existing.cost, model.cost]);
        existing.costUsd = sumNullable([existing.costUsd, model.costUsd]);
        addTokens(existing.tokens, model.tokens);
      }
    }

    return {
      ...first,
      currency: 'USD',
      cost: sumNullable(matching.map((range) => range.costUsd ?? range.cost)),
      costUsd: sumNullable(matching.map((range) => range.costUsd ?? range.cost)),
      tokens,
      models: Array.from(modelMap.values()).sort((left, right) => (right.costUsd ?? right.cost ?? 0) - (left.costUsd ?? left.cost ?? 0)),
      validEntries: matching.reduce((total, range) => total + range.validEntries, 0),
      skippedEntries: matching.reduce((total, range) => total + range.skippedEntries, 0),
      elapsedMs: matching.reduce((total, range) => total + range.elapsedMs, 0),
    };
  });

  return {
    source: 'all',
    displayName: 'All providers',
    currency: 'USD',
    generatedAt: latestTimestamp(overviews.map((overview) => overview.generatedAt)),
    cached: overviews.every((overview) => overview.cached),
    ranges,
  };
}

export default function CostSummarySection({
  source,
  refreshKey = 0,
  autoRefreshIntervalMs = DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  showTrend = true,
}: CostSummarySectionProps) {
  const [overview, setOverview] = useState<CostOverview | null>(null);
  const [daily, setDaily] = useState<CostDailyPoint[] | null>(null);
  const [sparkRange, setSparkRange] = useState<SparkRange>('7d');
  const [hoveredDay, setHoveredDay] = useState<CostDailyPoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceKey = Array.isArray(source) ? source.join(',') : source;
  const overview_generation = useLatestRequestGeneration();
  const daily_generation = useLatestRequestGeneration();

  useEffect(() => {
    let interval: number | undefined;

    const loadCost = async (force: boolean) => {
      const generation = overview_generation.begin();
      try {
        setLoading(true);
        setError(null);
        const sources = Array.isArray(source) ? source : [source];
        const overviews = await Promise.all(sources.map((item) => backend.getCostOverview(item, force)));
        if (!overview_generation.isCurrent(generation)) return;
        const data = mergeCostOverviews(overviews);
        setOverview(data);
      } catch (err) {
        if (!overview_generation.isCurrent(generation)) return;
        setError(getCostSummaryErrorMessage(err));
      } finally {
        if (overview_generation.isCurrent(generation)) {
          setLoading(false);
        }
      }
    };

    const loadDaily = async (force: boolean) => {
      const generation = daily_generation.begin();
      try {
        const sources = Array.isArray(source) ? source : [source];
        const seriesList = await Promise.all(
          sources.map((item) => backend.getCostDaily(item, DAILY_SERIES_DAYS, force)),
        );
        if (!daily_generation.isCurrent(generation)) return;
        setDaily(mergeDailySeries(seriesList));
      } catch (err) {
        if (!daily_generation.isCurrent(generation)) return;
        // The trend falls back to per-model bars; surface why in the console.
        console.error('Failed to load daily cost series:', err);
        setDaily(null);
      }
    };

    loadCost(refreshKey > 0);
    void loadDaily(refreshKey > 0);
    interval = startCostSummaryAutoRefresh(autoRefreshIntervalMs, (force) => {
      void loadCost(force);
      void loadDaily(force);
    });

    return () => {
      overview_generation.invalidate();
      daily_generation.invalidate();
      if (interval !== undefined) {
        clearInterval(interval);
      }
    };
  }, [sourceKey, refreshKey, autoRefreshIntervalMs, overview_generation, daily_generation]);

  const primaryRange = useMemo(() => pickPrimaryRange(overview), [overview]);
  const topModels = primaryRange?.models.slice(0, 3) ?? [];

  // Budgets are edited in Settings, which unmounts this component, so a
  // read-on-mount snapshot stays in sync.
  const monthlyBudget = useMemo(() => {
    const sources = Array.isArray(source) ? source : [source];
    return getBudgetForSources(getSavedMonthlyBudgets(), sources);
  }, [sourceKey]);
  const monthRange = overview?.ranges.find((range) => range.range === 'month') ?? null;
  const monthCost = monthRange ? monthRange.costUsd ?? monthRange.cost : null;
  const budgetPercent = monthlyBudget != null && monthCost != null
    ? (monthCost / monthlyBudget) * 100
    : null;

  return (
    <div className="section cost-section">
      <div className="cost-title-row">
        <span className="section-title">Local cost</span>
        {overview && <span className="cost-note">{formatCostNote(primaryRange)}</span>}
      </div>

      {loading && !overview && (
        <div className="cost-loading">Loading cost...</div>
      )}

      {error && !overview && (
        <div className="cost-inline-error">{error}</div>
      )}

      {overview && (
        <div className="cost-panel">
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
              {budgetPercent != null && monthlyBudget != null && (
                <div className="budget-panel">
                  <div className="budget-row">
                    <span>Monthly budget</span>
                    <strong>
                      {formatMoney(monthCost, monthRange?.currency ?? 'USD')}
                      {' / '}
                      {formatMoney(monthlyBudget, monthRange?.currency ?? 'USD')}
                    </strong>
                  </div>
                  <div className="budget-track">
                    <div className="budget-fill" style={getProgressStyle(budgetPercent)} />
                  </div>
                </div>
              )}

              {showTrend && daily && daily.length > 0 ? (
                (() => {
                  const sparkDays = sliceSparkDays(daily, sparkRange);
                  const maxCost = Math.max(...sparkDays.map((day) => day.costUsd ?? day.cost ?? 0), 0);
                  return (
                    <>
                      <div className="spark-bars" onMouseLeave={() => setHoveredDay(null)}>
                        {sparkDays.map((day, index) => {
                          const value = day.costUsd ?? day.cost ?? 0;
                          const height = maxCost > 0 ? Math.max(8, (value / maxCost) * 100) : 8;
                          const isHovered = hoveredDay?.date === day.date;
                          return (
                            <div
                              className={`spark-bar-hit ${isHovered ? 'hovered' : ''}`}
                              key={day.date}
                              onMouseEnter={() => setHoveredDay(day)}
                            >
                              <div
                                className={`spark-bar ${index === sparkDays.length - 1 ? 'latest' : ''} ${isHovered ? 'hovered' : ''}`}
                                style={{ height: `${height}%` }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="cost-footer">
                        <span className={hoveredDay ? 'spark-hover-label' : undefined}>
                          {hoveredDay
                            ? `${hoveredDay.date} · ${formatMoney(hoveredDay.costUsd ?? hoveredDay.cost ?? 0, primaryRange.currency)}`
                            : `${sparkRange === '7d' ? 'Past 7 days' : 'Past 30 days'} · ${formatMoney(sumDailyCost(sparkDays), primaryRange.currency)}`}
                        </span>
                        <span className="spark-range-chips">
                          <button
                            type="button"
                            className={`spark-chip ${sparkRange === '7d' ? 'active' : ''}`}
                            onClick={() => setSparkRange('7d')}
                          >
                            7D
                          </button>
                          <button
                            type="button"
                            className={`spark-chip ${sparkRange === '30d' ? 'active' : ''}`}
                            onClick={() => setSparkRange('30d')}
                          >
                            30D
                          </button>
                        </span>
                      </div>
                    </>
                  );
                })()
              ) : showTrend && topModels.length > 0 ? (
                <div className="spark-bars">
                  {topModels.map((model, index) => (
                    <div
                      className="spark-bar"
                      key={model.model}
                      title={`${model.model}: ${formatMoney(model.cost, primaryRange.currency)}`}
                      style={{ height: `${Math.max(18, 44 - index * 9)}%` }}
                    />
                  ))}
                </div>
              ) : null}
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

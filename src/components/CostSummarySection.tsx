import { localizeLabel, getLocale, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

export function dayCost(day: Pick<CostDailyPoint, 'cost' | 'costUsd'>): number | null {
  const value = day.costUsd ?? day.cost;
  return value == null || !Number.isFinite(value) ? null : value;
}

export function sumDailyCost(days: CostDailyPoint[]): number | null {
  return sumNullable(days.map((day) => dayCost(day)));
}

export function startCostSummaryAutoRefresh(
  autoRefreshIntervalMs: number,
  loadCost: (force: boolean) => void | Promise<void>,
): ReturnType<typeof setInterval> | undefined {
  if (autoRefreshIntervalMs <= 0) return undefined;
  // Non-forced so the backend cache TTL governs how often local logs are
  // re-parsed; only a manual refresh bypasses it.
  return setInterval(() => {
    void loadCost(false);
  }, autoRefreshIntervalMs);
}

export function getCostSummaryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = err.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return t("Failed to load cost summary");
}

export function formatCostMoney(
  value: number | null | undefined,
  currency: string,
  locale = getLocale(),
): string {
  if (value == null || !Number.isFinite(value)) return t("n/a");

  const maximumFractionDigits = Math.abs(value) < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(maximumFractionDigits)}`;
  }
}

const COST_RANGE_MIN_FONT_PX = 9;

export function nextCostRangeFontSize(
  currentPx: number,
  clientWidth: number,
  scrollWidth: number,
  minPx = COST_RANGE_MIN_FONT_PX,
): number | null {
  if (!(currentPx > 0) || !(clientWidth > 1) || !(scrollWidth > clientWidth)) return null;
  return Math.max(minPx, currentPx * ((clientWidth - 1) / scrollWidth));
}

function fitCostRangeAmount(el: HTMLElement): void {
  el.style.removeProperty('font-size');
  for (let pass = 0; pass < 8; pass += 1) {
    const next = nextCostRangeFontSize(
      parseFloat(getComputedStyle(el).fontSize),
      el.clientWidth,
      el.scrollWidth,
    );
    if (next == null) return;
    el.style.fontSize = `${next}px`;
  }
}

function CostRangeAmount({ value }: { value: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitCostRangeAmount(el);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitCostRangeAmount(el));
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [value]);
  return <strong ref={ref} className="cost-range-value" title={value}>{value}</strong>;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(getLocale(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUpdatedAt(value: string): string {
  try {
    return new Date(value).toLocaleTimeString(getLocale(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatCostNote(range: CostRangeSummary | null): string {
  if (!range) return '';
  return t("{p0} tokens", { p0: formatCompactNumber(range.tokens.totalTokens) });
}

export function formatCostCompleteness(overview: CostOverview): string {
  const skipped = overview.ranges.reduce((total, range) => total + (range.skippedEntries ?? 0), 0);
  const parseErrors = overview.ranges.reduce((total, range) => total + (range.parseErrorEntries ?? 0), 0);
  const parts: string[] = [];
  if (skipped > 0) parts.push(t("{p0} skipped", { p0: skipped }));
  if (parseErrors > 0) parts.push(t("{p0} parse errors", { p0: parseErrors }));
  const kinds = new Set(
    overview.ranges
      .map((range) => range.costKind)
      .filter((kind): kind is string => Boolean(kind) && kind !== 'real' && kind !== 'none'),
  );
  if (kinds.has('mixed') || kinds.size > 1) parts.push(localizeLabel('mixed'));
  else if (kinds.has('estimated_proxy')) parts.push(localizeLabel('estimated'));
  else if (kinds.size === 1) parts.push(localizeLabel([...kinds][0]));
  return parts.join(' · ');
}

export function formatCostFreshness(overview: CostOverview): string {
  if (overview.stale) return t("Stale");
  if (overview.cached) return t("Cached");
  return '';
}

function mergeCostKinds(kinds: string[]): string {
  const unique = [...new Set(kinds.filter(Boolean))];
  if (unique.length === 0) return 'none';
  if (unique.length === 1) return unique[0];
  return 'mixed';
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

export const MERGED_COST_DISPLAY_NAME = 'Claude, Codex, Cursor';

export function mergeCostOverviews(overviews: CostOverview[]): CostOverview {
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
      parseErrorEntries: matching.reduce((total, range) => total + (range.parseErrorEntries ?? 0), 0),
      costKind: mergeCostKinds(matching.map((range) => range.costKind)),
      estimatedCost: sumNullable(matching.map((range) => range.estimatedCost)),
      estimatedCostUsd: sumNullable(matching.map((range) => range.estimatedCostUsd)),
      elapsedMs: matching.reduce((total, range) => total + range.elapsedMs, 0),
    };
  });

  return {
    source: 'all',
    displayName: MERGED_COST_DISPLAY_NAME,
    currency: 'USD',
    generatedAt: latestTimestamp(overviews.map((overview) => overview.generatedAt)),
    cached: overviews.every((overview) => overview.cached),
    stale: overviews.some((overview) => Boolean(overview.stale)),
    ranges,
  };
}

export default function CostSummarySection({
  source,
  refreshKey = 0,
  autoRefreshIntervalMs = DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  showTrend = true,
}: CostSummarySectionProps) {
  useLocale();
  const [overview, setOverview] = useState<CostOverview | null>(null);
  const [daily, setDaily] = useState<CostDailyPoint[] | null>(null);
  const [sparkRange, setSparkRange] = useState<SparkRange>('7d');
  const [hoveredDay, setHoveredDay] = useState<CostDailyPoint | null>(null);
  const [focusedDay, setFocusedDay] = useState<CostDailyPoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceKey = Array.isArray(source) ? source.join(',') : source;
  const overview_generation = useLatestRequestGeneration();
  const daily_generation = useLatestRequestGeneration();
  const lastRefreshKeyRef = useRef(refreshKey);

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
        setDailyError(null);
      } catch (err) {
        if (!daily_generation.isCurrent(generation)) return;
        console.error('Failed to load daily cost series:', err);
        setDailyError(getCostSummaryErrorMessage(err));
        setDaily(null);
      }
    };

    // Force only when the manual-refresh nonce actually advanced; otherwise a
    // single manual refresh would make every later effect run bypass the cache.
    const manualRefresh = refreshKey > lastRefreshKeyRef.current;
    lastRefreshKeyRef.current = refreshKey;
    loadCost(manualRefresh);
    void loadDaily(manualRefresh);
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
        <span className="section-title">{t("API-equivalent usage")}</span>
        <span className="cost-title-meta">
          <span className="cost-estimate-badge">{t("Local estimate")}</span>
          {overview && <span className="cost-note">{formatCostNote(primaryRange)}</span>}
        </span>
      </div>

      <p className="cost-estimate-explanation">
        {Array.isArray(source)
          ? t("Estimated from local Claude, Codex and Cursor logs at API prices; not a bill. Excludes Grok and Antigravity.")
          : t("Estimated from local logs at API prices; not a bill.")}
      </p>

      {loading && !overview && (
        <div className="cost-loading">{t("Loading costs…")}</div>
      )}

      {error && !overview && (
        <div className="cost-inline-error">{localizeLabel(error)}</div>
      )}

      {showTrend && dailyError && <p className="cost-inline-error" role="alert">{t("Could not load trend:")}{" "}{localizeLabel(dailyError)}</p>}
      {overview && (
        <div className="cost-panel">
          <div className="cost-range-grid">
            {overview.ranges.map((range) => {
              const amount = formatCostMoney(range.cost, range.currency);
              return (
                <div
                  className={`cost-range ${range.range === primaryRange?.range ? 'active' : ''}`}
                  key={range.range}
                >
                  <span className="cost-range-label">{localizeLabel(range.label)}</span>
                  <CostRangeAmount value={amount} />
                </div>
              );
            })}
          </div>

          {primaryRange && (
            <>
              {budgetPercent != null && monthlyBudget != null && (
                <div className="budget-panel">
                  <div className="budget-row">
                    <span>{t("Monthly reference budget")}</span>
                    <strong>
                      {formatCostMoney(monthCost, monthRange?.currency ?? 'USD')}
                      {' / '}
                      {formatCostMoney(monthlyBudget, monthRange?.currency ?? 'USD')}
                    </strong>
                  </div>
                  <div
                    className="budget-track"
                    role="progressbar"
                    aria-label={t("Monthly API-equivalent budget used")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(100, Math.round(budgetPercent))}
                    aria-valuetext={t("{p0}% of monthly budget used", { p0: Math.round(budgetPercent) })}
                  >
                    <div className="budget-fill" style={getProgressStyle(budgetPercent)} />
                  </div>
                </div>
              )}

              {showTrend && daily && daily.length > 0 ? (
                (() => {
                  const sparkDays = sliceSparkDays(daily, sparkRange);
                  const knownCosts = sparkDays.map((day) => dayCost(day)).filter((value): value is number => value != null);
                  const maxCost = knownCosts.length > 0 ? Math.max(...knownCosts) : 0;
                  const focusedIndex = focusedDay
                    ? sparkDays.findIndex((day) => day.date === focusedDay.date)
                    : -1;
                  const inspectedCandidate = hoveredDay ?? focusedDay;
                  const inspectedIndex = inspectedCandidate
                    ? sparkDays.findIndex((day) => day.date === inspectedCandidate.date)
                    : -1;
                  const inspectedDay = inspectedIndex >= 0 ? sparkDays[inspectedIndex] : null;
                  const activeIndex = inspectedIndex >= 0 ? inspectedIndex : sparkDays.length - 1;
                  const activeDay = sparkDays[activeIndex];
                  const activeValue = activeDay ? dayCost(activeDay) : null;
                  const focusDay = (index: number) => {
                    const day = sparkDays[index];
                    if (day) setFocusedDay(day);
                  };
                  return (
                    <>
                      <div
                        className="spark-bars"
                        role="slider"
                        tabIndex={0}
                        aria-label={t("Daily API-equivalent usage trend")}
                        aria-valuemin={1}
                        aria-valuemax={sparkDays.length}
                        aria-valuenow={activeIndex + 1}
                        aria-valuetext={activeDay ? `${activeDay.date}: ${formatCostMoney(activeValue, primaryRange.currency)}` : t("n/a")}
                        onFocus={() => focusDay(activeIndex)}
                        onBlur={() => setFocusedDay(null)}
                        onMouseLeave={() => setHoveredDay(null)}
                        onKeyDown={(event) => {
                          const keyboardIndex = focusedIndex >= 0 ? focusedIndex : activeIndex;
                          let nextIndex = keyboardIndex;
                          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextIndex = Math.max(0, keyboardIndex - 1);
                          else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextIndex = Math.min(sparkDays.length - 1, keyboardIndex + 1);
                          else if (event.key === 'Home') nextIndex = 0;
                          else if (event.key === 'End') nextIndex = sparkDays.length - 1;
                          else return;
                          event.preventDefault();
                          setHoveredDay(null);
                          focusDay(nextIndex);
                        }}
                      >
                        {sparkDays.map((day, index) => {
                          const value = dayCost(day);
                          const isGap = value == null;
                          const height = isGap
                            ? 0
                            : maxCost > 0
                              ? Math.max(8, (value / maxCost) * 100)
                              : 8;
                          const isHovered = inspectedDay?.date === day.date;
                          return (
                            <span
                              className={`spark-bar-hit${isHovered ? ' hovered' : ''}${isGap ? ' gap' : ''}`}
                              key={day.date}
                              onMouseEnter={() => setHoveredDay(day)}
                              aria-hidden="true"
                            >
                              {isGap ? null : (
                                <span
                                  className={`spark-bar ${index === sparkDays.length - 1 ? 'latest' : ''} ${isHovered ? 'hovered' : ''}`}
                                  style={{ height: `${height}%` }}
                                />
                              )}
                            </span>
                          );
                        })}
                      </div>
                      <div className="cost-footer">
                        <span className={inspectedDay ? 'spark-hover-label' : undefined}>
                          {inspectedDay
                            ? `${inspectedDay.date} · ${formatCostMoney(dayCost(inspectedDay), primaryRange.currency)}`
                            : `${sparkRange === '7d' ? t("Past 7 days") : t("Past 30 days")} · ${formatCostMoney(sumDailyCost(sparkDays), primaryRange.currency)}`}
                        </span>
                        <span className="spark-range-chips">
                          <button
                            type="button"
                            className={`spark-chip ${sparkRange === '7d' ? 'active' : ''}`}
                            onClick={() => setSparkRange('7d')}
                          >
                            {t("7D")}</button>
                          <button
                            type="button"
                            className={`spark-chip ${sparkRange === '30d' ? 'active' : ''}`}
                            onClick={() => setSparkRange('30d')}
                          >
                            {t("30D")}</button>
                        </span>
                      </div>
                    </>
                  );
                })()
              ) : showTrend && topModels.length > 0 ? (
                <div className="cost-model-list" aria-label={t("Model costs")}>
                  {topModels.map((model) => (
                    <div className="cost-footer" key={model.model}>
                      <span>{model.model}</span><span>{formatCostMoney(model.cost, primaryRange.currency)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}

          <div className="cost-footer">
            <span>{primaryRange?.label ?? overview.displayName}</span>
            <span>
              {[formatCostCompleteness(overview), formatCostFreshness(overview), formatUpdatedAt(overview.generatedAt)]
                .filter((part) => part.length > 0)
                .join(' · ')}
            </span>
          </div>

          {error && <div className="cost-inline-error compact">{localizeLabel(error)}</div>}
        </div>
      )}
    </div>
  );
}

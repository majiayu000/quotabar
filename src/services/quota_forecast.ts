import { getLocale, t } from '../i18n';
import type { QuotaWindowSummary } from './provider_summary';

/**
 * Exhaustion forecast from recent provider-reported readings.
 *
 * Polling runs every 60 s, so one hour of history holds up to ~60 readings.
 * The forecast fits a least-squares line to the last hour and needs at least
 * four readings spanning 15 minutes: providers report whole percentages, and
 * a shorter span turns a single 1-point step into an extreme burn rate.
 * Unknown is never shown as a forecast.
 */
export const FORECAST_LOOKBACK_MS = 60 * 60_000;
export const FORECAST_MIN_SAMPLES = 4;
export const FORECAST_MIN_SPAN_MS = 15 * 60_000;
/** A forecast whose newest reading is older than this is not shown. */
export const FORECAST_MAX_SAMPLE_AGE_MS = 10 * 60_000;
/** Reset times that move further than this belong to a new quota period. */
const RESET_SHIFT_TOLERANCE_MS = 15 * 60_000;
/** A drop of at least one percentage point in usage means the window reset. */
const RESET_USAGE_DROP = 1;
const MAX_SAMPLES = 120;

export interface QuotaSample {
  at: number;
  usedPercent: number;
  resetAtMs: number;
}

export type QuotaHistory = Readonly<Record<string, readonly QuotaSample[]>>;

export type QuotaForecast =
  | { kind: 'before_reset'; exhaustAtMs: number; resetAtMs: number }
  | { kind: 'after_reset'; resetAtMs: number };

export type QuotaForecastMap = Readonly<Record<string, QuotaForecast>>;

export function quotaWindowKey(window: Pick<QuotaWindowSummary, 'provider' | 'label'>): string {
  return `${window.provider}:${window.label}`;
}

function isValidSample(sample: QuotaSample): boolean {
  return Number.isFinite(sample.at)
    && Number.isFinite(sample.usedPercent)
    && Number.isFinite(sample.resetAtMs);
}

function startsNewPeriod(last: QuotaSample, next: QuotaSample): boolean {
  return Math.abs(next.resetAtMs - last.resetAtMs) > RESET_SHIFT_TOLERANCE_MS
    || next.usedPercent <= last.usedPercent - RESET_USAGE_DROP
    || next.at >= last.resetAtMs;
}

/** Appends one reading; a reset (usage drop or new reset time) clears the history. */
export function appendQuotaSample(
  samples: readonly QuotaSample[] | undefined,
  sample: QuotaSample,
): QuotaSample[] {
  const previous = samples ?? [];
  if (!isValidSample(sample)) return [...previous];
  const last = previous[previous.length - 1];
  if (last && sample.at < last.at) return [...previous];
  const kept = !last || startsNewPeriod(last, sample)
    ? []
    : previous.filter((item) => item.at < sample.at && sample.at - item.at <= FORECAST_LOOKBACK_MS);
  return [...kept, sample].slice(-MAX_SAMPLES);
}

/** Records the windows of one successful provider read. */
export function recordQuotaRead(
  history: QuotaHistory,
  windows: readonly QuotaWindowSummary[],
  readAt: number,
): QuotaHistory {
  let next: Record<string, readonly QuotaSample[]> | null = null;
  for (const window of windows) {
    if (typeof window.resetAtMs !== 'number' || !Number.isFinite(window.usedPercent)) continue;
    const key = quotaWindowKey(window);
    next ??= { ...history };
    next[key] = appendQuotaSample(next[key], {
      at: readAt,
      usedPercent: window.usedPercent,
      resetAtMs: window.resetAtMs,
    });
  }
  return next ?? history;
}

function burnRatePerMs(samples: readonly QuotaSample[]): number {
  const origin = samples[0].at;
  const count = samples.length;
  const meanX = samples.reduce((sum, sample) => sum + (sample.at - origin), 0) / count;
  const meanY = samples.reduce((sum, sample) => sum + sample.usedPercent, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const dx = sample.at - origin - meanX;
    numerator += dx * (sample.usedPercent - meanY);
    denominator += dx * dx;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Projects when the window reaches 100% used at the recent burn rate.
 * Returns null without enough recent signal, a non-positive slope, stale
 * readings, a passed reset, or an already exhausted window.
 */
export function forecastQuotaExhaustion(
  samples: readonly QuotaSample[] | undefined,
  now: number = Date.now(),
): QuotaForecast | null {
  const last = samples?.[samples.length - 1];
  if (!samples || !last) return null;
  if (now - last.at > FORECAST_MAX_SAMPLE_AGE_MS) return null;
  if (last.usedPercent >= 100 || last.resetAtMs <= now) return null;
  const recent = samples.filter((sample) => last.at - sample.at <= FORECAST_LOOKBACK_MS);
  if (recent.length < FORECAST_MIN_SAMPLES) return null;
  if (last.at - recent[0].at < FORECAST_MIN_SPAN_MS) return null;
  const rate = burnRatePerMs(recent);
  if (!(rate > 0)) return null;
  const exhaustAtMs = last.at + (100 - last.usedPercent) / rate;
  if (!Number.isFinite(exhaustAtMs)) return null;
  return exhaustAtMs < last.resetAtMs
    ? { kind: 'before_reset', exhaustAtMs, resetAtMs: last.resetAtMs }
    : { kind: 'after_reset', resetAtMs: last.resetAtMs };
}

export function forecastQuotaWindows(history: QuotaHistory, now: number = Date.now()): QuotaForecastMap {
  const forecasts: Record<string, QuotaForecast> = {};
  for (const [key, samples] of Object.entries(history)) {
    const forecast = forecastQuotaExhaustion(samples, now);
    if (forecast) forecasts[key] = forecast;
  }
  return forecasts;
}

const DAY_MS = 24 * 60 * 60_000;

/** Local clock time; adds the weekday (and date beyond six days) when not today. */
export function formatForecastClock(atMs: number, now: number = Date.now()): string {
  const date = new Date(atMs);
  const time = date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  const day = date.toLocaleDateString(getLocale(), atMs - now > 6 * DAY_MS
    ? { weekday: 'short', month: 'numeric', day: 'numeric' }
    : { weekday: 'short' });
  return `${day} ${time}`;
}

/** Detail rows: full estimate sentence, both outcomes. */
export function formatForecastText(forecast: QuotaForecast | undefined, now: number = Date.now()): string | null {
  if (!forecast) return null;
  if (forecast.kind === 'before_reset') {
    return t("Estimate: at this pace, runs out ~{p0} (before {p1} reset)", {
      p0: formatForecastClock(forecast.exhaustAtMs, now),
      p1: formatForecastClock(forecast.resetAtMs, now),
    });
  }
  return t("Estimate: pace OK, resets first ({p0})", { p0: formatForecastClock(forecast.resetAtMs, now) });
}

export function getQuotaForecast(
  forecasts: QuotaForecastMap | undefined,
  window: Pick<QuotaWindowSummary, 'provider' | 'label'>,
): QuotaForecast | undefined {
  return forecasts?.[quotaWindowKey(window)];
}

/** Overview headline: only the actionable outcome, kept short. */
export function formatForecastHeadline(forecast: QuotaForecast | undefined, now: number = Date.now()): string | null {
  if (forecast?.kind !== 'before_reset') return null;
  return t("Est. runs out ~{p0}, before reset", { p0: formatForecastClock(forecast.exhaustAtMs, now) });
}

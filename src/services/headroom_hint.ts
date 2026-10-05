import type { ProviderSummary, QuotaWindowSummary } from './provider_summary';
import { FORECAST_MAX_SAMPLE_AGE_MS, getQuotaForecast, type QuotaForecastMap } from './quota_forecast';

/** Same boundary as the warning color and high-usage tip: 20% remaining. */
export const HEADROOM_WARNING_USED_PERCENT = 80;
/** The other provider must have at least this much remaining... */
export const HEADROOM_MIN_REMAINING_PERCENT = 40;
/** ...and at least this many more points than the constrained window. */
export const HEADROOM_MIN_ADVANTAGE_PERCENT = 30;
/** Readings older than the forecast freshness limit are not compared. */
export const HEADROOM_MAX_READ_AGE_MS = FORECAST_MAX_SAMPLE_AGE_MS;

export interface HeadroomHint {
  constrained: QuotaWindowSummary;
  alternative: QuotaWindowSummary;
}

function isFresh(summary: ProviderSummary, now: number): boolean {
  if (summary.id === 'antigravity' || !summary.connected || summary.failed || summary.readState?.error) return false;
  const readAt = summary.lastSuccessAt ?? summary.readState?.readAt;
  return readAt != null && now - readAt >= 0 && now - readAt <= HEADROOM_MAX_READ_AGE_MS;
}

function providerHeadline(provider: ProviderSummary['id'], windows: readonly QuotaWindowSummary[]): QuotaWindowSummary | undefined {
  return windows
    .filter((window) => window.provider === provider && Number.isFinite(window.usedPercent))
    .reduce<QuotaWindowSummary | undefined>((current, window) =>
      !current || window.usedPercent > current.usedPercent ? window : current, undefined);
}

/**
 * When the most constrained fresh window is low or projected to run out before
 * its reset, points to one other fresh provider with substantially more
 * remaining. Stale, failed, missing and placeholder providers never qualify.
 */
export function selectHeadroomHint(
  summaries: readonly ProviderSummary[],
  windows: readonly QuotaWindowSummary[],
  forecasts: QuotaForecastMap | undefined,
  now: number = Date.now(),
): HeadroomHint | null {
  const headlines = summaries
    .filter((summary) => isFresh(summary, now))
    .map((summary) => providerHeadline(summary.id, windows))
    .filter((window): window is QuotaWindowSummary => window !== undefined);
  const constrained = headlines.reduce<QuotaWindowSummary | undefined>((current, window) =>
    !current || window.usedPercent > current.usedPercent ? window : current, undefined);
  if (!constrained) return null;
  const runsOutFirst = getQuotaForecast(forecasts, constrained)?.kind === 'before_reset';
  if (constrained.usedPercent < HEADROOM_WARNING_USED_PERCENT && !runsOutFirst) return null;

  const constrainedRemaining = 100 - constrained.usedPercent;
  const alternative = headlines
    .filter((window) => window.provider !== constrained.provider)
    .filter((window) => getQuotaForecast(forecasts, window)?.kind !== 'before_reset')
    .filter((window) => {
      const remaining = 100 - window.usedPercent;
      return remaining >= HEADROOM_MIN_REMAINING_PERCENT
        && remaining - constrainedRemaining >= HEADROOM_MIN_ADVANTAGE_PERCENT;
    })
    .reduce<QuotaWindowSummary | undefined>((best, window) =>
      !best || window.usedPercent < best.usedPercent ? window : best, undefined);
  return alternative ? { constrained, alternative } : null;
}

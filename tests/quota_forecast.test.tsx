import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useQuotaForecasts } from '../src/hooks/use_quota_forecasts';
import { defaultServiceMap } from '../src/services/app_state';
import type { ProviderReadState } from '../src/services/provider_summary';
import QuotaOverview from '../src/components/QuotaOverview';
import { DEFAULT_QUOTA_DISPLAY } from '../src/services/quota_display';
import type { ProviderSummary, QuotaWindowSummary } from '../src/services/provider_summary';
import {
  FORECAST_MAX_SAMPLE_AGE_MS,
  appendQuotaSample,
  forecastQuotaExhaustion,
  formatForecastText,
  quotaWindowKey,
  recordQuotaRead,
  type QuotaSample,
} from '../src/services/quota_forecast';

const MINUTE = 60_000;
const NOW = Date.parse('2026-10-05T12:00:00Z');

function series(usedPercents: number[], resetAtMs: number, stepMs = 5 * MINUTE, endAt = NOW): QuotaSample[] {
  return usedPercents.reduce<QuotaSample[]>((samples, usedPercent, index) => appendQuotaSample(samples, {
    at: endAt - (usedPercents.length - 1 - index) * stepMs,
    usedPercent,
    resetAtMs,
  }), []);
}

describe('quota exhaustion forecast', () => {
  const resetIn3h = NOW + 180 * MINUTE;

  it('stays unknown with too few samples or too short a span', () => {
    expect(forecastQuotaExhaustion(undefined, NOW)).toBeNull();
    expect(forecastQuotaExhaustion(series([40, 45, 50], resetIn3h), NOW)).toBeNull();
    // Four samples one minute apart: enough count, not enough span.
    expect(forecastQuotaExhaustion(series([40, 45, 50, 55], resetIn3h, MINUTE), NOW)).toBeNull();
  });

  it('stays unknown for a flat or falling slope', () => {
    expect(forecastQuotaExhaustion(series([40, 40, 40, 40, 40], resetIn3h), NOW)).toBeNull();
    const falling: QuotaSample[] = [50, 49.8, 49.6, 49.4, 49.2].map((usedPercent, index) => ({
      at: NOW - (4 - index) * 5 * MINUTE, usedPercent, resetAtMs: resetIn3h,
    }));
    expect(forecastQuotaExhaustion(falling, NOW)).toBeNull();
  });

  it('projects exhaustion before the reset at a fast recent pace', () => {
    // 2 points per 5 minutes = 24/h; 40 points left run out in 100 minutes.
    const forecast = forecastQuotaExhaustion(series([52, 54, 56, 58, 60], resetIn3h), NOW);
    expect(forecast?.kind).toBe('before_reset');
    expect(forecast?.kind === 'before_reset' && forecast.exhaustAtMs).toBeCloseTo(NOW + 100 * MINUTE, -3);
    expect(forecast?.resetAtMs).toBe(resetIn3h);
  });

  it('reports pace OK when the reset arrives first', () => {
    // 1 point per 20 minutes leaves 40 points for ~13 hours, beyond a 3-hour reset.
    const forecast = forecastQuotaExhaustion(series([59, 59, 60, 60, 60, 61, 61, 61, 62, 62, 62, 63, 63], resetIn3h), NOW);
    expect(forecast).toEqual({ kind: 'after_reset', resetAtMs: resetIn3h });
  });

  it('only uses the recent lookback, not the whole window', () => {
    // Heavy usage two hours ago, flat for the last hour: no forecast.
    const samples = series([10, 30, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], resetIn3h);
    expect(forecastQuotaExhaustion(samples, NOW)).toBeNull();
  });

  it('hides the forecast once the newest reading is stale', () => {
    const samples = series([52, 54, 56, 58, 60], resetIn3h);
    expect(forecastQuotaExhaustion(samples, NOW + FORECAST_MAX_SAMPLE_AGE_MS)).not.toBeNull();
    expect(forecastQuotaExhaustion(samples, NOW + FORECAST_MAX_SAMPLE_AGE_MS + 1)).toBeNull();
  });

  it('clears history on a usage drop or a new reset time', () => {
    const samples = series([52, 54, 56, 58, 60], resetIn3h);
    const afterDrop = appendQuotaSample(samples, { at: NOW + MINUTE, usedPercent: 3, resetAtMs: resetIn3h });
    expect(afterDrop).toEqual([{ at: NOW + MINUTE, usedPercent: 3, resetAtMs: resetIn3h }]);
    expect(forecastQuotaExhaustion(afterDrop, NOW + MINUTE)).toBeNull();

    const nextPeriod = NOW + 5 * 60 * MINUTE;
    const afterShift = appendQuotaSample(samples, { at: NOW + MINUTE, usedPercent: 61, resetAtMs: nextPeriod });
    expect(afterShift).toHaveLength(1);

    // Small reset-time jitter keeps the same period.
    expect(appendQuotaSample(samples, { at: NOW + MINUTE, usedPercent: 61, resetAtMs: resetIn3h + 2_000 })).toHaveLength(6);
  });

  it('records only windows that carry a reset time, keyed per provider window', () => {
    const windows: QuotaWindowSummary[] = [
      { provider: 'grok', providerLabel: 'Grok', label: 'Weekly pool', usedPercent: 20, resetAtMs: resetIn3h },
      { provider: 'grok', providerLabel: 'Grok', label: 'Extra credits', usedPercent: 50 },
    ];
    const history = recordQuotaRead({}, windows, NOW);
    expect(Object.keys(history)).toEqual([quotaWindowKey(windows[0])]);
  });

  it('labels the result as an estimate', () => {
    const text = formatForecastText({ kind: 'before_reset', exhaustAtMs: NOW + 100 * MINUTE, resetAtMs: resetIn3h }, NOW);
    expect(text).toMatch(/^Estimate: at this pace, runs out ~.+ \(before .+ reset\)$/);
    expect(formatForecastText({ kind: 'after_reset', resetAtMs: resetIn3h }, NOW)).toMatch(/^Estimate: pace OK, resets first/);
    expect(formatForecastText(undefined, NOW)).toBeNull();
  });
});

describe('overview headline forecast', () => {
  const claude: ProviderSummary = {
    id: 'claude', label: 'Claude', shortLabel: 'Claude', initials: 'C', accent: '#d97757',
    connected: true, loading: false, usedPercent: 60, statusText: '',
  };
  const headline: QuotaWindowSummary = {
    provider: 'claude', providerLabel: 'Claude', label: '5-hour usage', usedPercent: 60, resetAtMs: Date.now() + 180 * MINUTE,
  };
  const props = {
    windows: [headline], display: DEFAULT_QUOTA_DISPLAY,
    onProviderSelect: vi.fn(), onRefresh: vi.fn(), onSettings: vi.fn(),
  };

  it('shows only a before-reset estimate on the headline', () => {
    const before = { [quotaWindowKey(headline)]: { kind: 'before_reset' as const, exhaustAtMs: Date.now() + 60 * MINUTE, resetAtMs: headline.resetAtMs! } };
    expect(renderToStaticMarkup(<QuotaOverview {...props} summaries={[claude]} forecasts={before} />))
      .toContain('Est. runs out ~');
    const after = { [quotaWindowKey(headline)]: { kind: 'after_reset' as const, resetAtMs: headline.resetAtMs! } };
    expect(renderToStaticMarkup(<QuotaOverview {...props} summaries={[claude]} forecasts={after} />))
      .not.toContain('quota-account-forecast');
  });

  it('does not show an estimate next to stale data', () => {
    const before = { [quotaWindowKey(headline)]: { kind: 'before_reset' as const, exhaustAtMs: Date.now() + 60 * MINUTE, resetAtMs: headline.resetAtMs! } };
    const html = renderToStaticMarkup(<QuotaOverview {...props} summaries={[{ ...claude, failed: true }]} forecasts={before} />);
    expect(html).not.toContain('Est. runs out');
  });
});

describe('forecast history from provider reads', () => {
  it('samples successful reads only and hides forecasts while a read is failing', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const start = NOW;
    const resetAtMs = NOW + 300 * MINUTE;
    let result: ReturnType<typeof useQuotaForecasts> = {};
    function Probe({ used, reads }: { used: number; reads: Record<string, ProviderReadState> }) {
      result = useQuotaForecasts(
        [{ provider: 'codex', providerLabel: 'Codex', label: '5h', usedPercent: used, resetAtMs }],
        reads as ReturnType<typeof defaultServiceMap<ProviderReadState>>,
      );
      return null;
    }
    const reads = (readAt: number, error: string | null = null) => ({
      ...defaultServiceMap<ProviderReadState>({ error: null, readAt: null }), codex: { error, readAt },
    });
    const renderer = create(<Probe used={50} reads={reads(start)} />);
    for (let step = 1; step <= 4; step += 1) {
      vi.setSystemTime(start + step * 5 * MINUTE);
      await act(async () => renderer.update(<Probe used={50 + step * 3} reads={reads(start + step * 5 * MINUTE)} />));
    }
    expect(result[quotaWindowKey({ provider: 'codex', label: '5h' })]?.kind).toBe('before_reset');

    // A failed read keeps the last known data but must not show an estimate.
    await act(async () => renderer.update(<Probe used={62} reads={reads(start + 20 * MINUTE, 'HTTP 500')} />));
    expect(result).toEqual({});
    await act(async () => renderer.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

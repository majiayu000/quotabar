import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QuotaOverview from '../src/components/QuotaOverview';
import { setLanguagePreference } from '../src/i18n';
import { selectHeadroomHint, HEADROOM_MAX_READ_AGE_MS } from '../src/services/headroom_hint';
import { DEFAULT_QUOTA_DISPLAY } from '../src/services/quota_display';
import { quotaWindowKey } from '../src/services/quota_forecast';
import type { ProviderSummary, QuotaWindowSummary } from '../src/services/provider_summary';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const HOUR = 60 * 60_000;

function summary(id: ProviderSummary['id'], label: string, overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id, label, shortLabel: label, initials: label[0], accent: '#000',
    connected: true, loading: false, usedPercent: null, statusText: '',
    lastSuccessAt: NOW - 60_000, readState: { error: null, readAt: NOW - 60_000 },
    ...overrides,
  };
}

const claudeWeekly: QuotaWindowSummary = { provider: 'claude', providerLabel: 'Claude', label: '7-day usage', usedPercent: 92, resetAtMs: NOW + 48 * HOUR };
const claudeSession: QuotaWindowSummary = { provider: 'claude', providerLabel: 'Claude', label: '5-hour usage', usedPercent: 30, resetAtMs: NOW + 2 * HOUR };
const codexWeekly: QuotaWindowSummary = { provider: 'codex', providerLabel: 'Codex', label: 'Weekly', usedPercent: 36, resetAtMs: NOW + 72 * HOUR };
const windows = [claudeWeekly, claudeSession, codexWeekly];
const summaries = [summary('claude', 'Claude'), summary('codex', 'Codex')];

describe('cross-provider headroom hint', () => {
  it('points from a low headline window to a fresh provider with more remaining', () => {
    expect(selectHeadroomHint(summaries, windows, {}, NOW)).toEqual({ constrained: claudeWeekly, alternative: codexWeekly });
  });

  it('compares the other provider by its own most constrained window', () => {
    const codexShort: QuotaWindowSummary = { ...codexWeekly, label: '5h', usedPercent: 85 };
    expect(selectHeadroomHint(summaries, [...windows, codexShort], {}, NOW)).toBeNull();
  });

  it('stays hidden when the headline window is not low and not forecast to run out', () => {
    const relaxed = [{ ...claudeWeekly, usedPercent: 70 }, claudeSession, codexWeekly];
    expect(selectHeadroomHint(summaries, relaxed, {}, NOW)).toBeNull();
    const forecasts = { [quotaWindowKey(claudeWeekly)]: { kind: 'before_reset' as const, exhaustAtMs: NOW + HOUR, resetAtMs: claudeWeekly.resetAtMs! } };
    expect(selectHeadroomHint(summaries, relaxed, forecasts, NOW)?.alternative).toBe(codexWeekly);
  });

  it('requires substantially more remaining on the other provider', () => {
    expect(selectHeadroomHint(summaries, [claudeWeekly, { ...codexWeekly, usedPercent: 65 }], {}, NOW)).toBeNull();
  });

  it('never uses stale, failed, disconnected or placeholder providers', () => {
    const stale = summary('codex', 'Codex', { lastSuccessAt: NOW - HEADROOM_MAX_READ_AGE_MS - 1, readState: { error: null, readAt: NOW - HEADROOM_MAX_READ_AGE_MS - 1 } });
    expect(selectHeadroomHint([summaries[0], stale], windows, {}, NOW)).toBeNull();
    const failed = summary('codex', 'Codex', { failed: true, readState: { error: 'HTTP 500', readAt: NOW - 60_000 } });
    expect(selectHeadroomHint([summaries[0], failed], windows, {}, NOW)).toBeNull();
    expect(selectHeadroomHint([summaries[0], summary('codex', 'Codex', { connected: false })], windows, {}, NOW)).toBeNull();
    const antigravity: QuotaWindowSummary = { provider: 'antigravity', providerLabel: 'Antigravity', label: 'Usage', usedPercent: 0 };
    expect(selectHeadroomHint([summaries[0], summary('antigravity', 'Antigravity')], [claudeWeekly, antigravity], {}, NOW)).toBeNull();
    // A stale constrained provider does not trigger advice either.
    const staleClaude = summary('claude', 'Claude', { failed: true, readState: { error: 'HTTP 429', readAt: NOW - 60_000 } });
    expect(selectHeadroomHint([staleClaude, summaries[1]], windows, {}, NOW)).toBeNull();
  });

  it('skips another provider that is itself projected to run out', () => {
    const forecasts = { [quotaWindowKey(codexWeekly)]: { kind: 'before_reset' as const, exhaustAtMs: NOW + HOUR, resetAtMs: codexWeekly.resetAtMs! } };
    expect(selectHeadroomHint(summaries, windows, forecasts, NOW)).toBeNull();
  });
});

describe('overview headroom copy', () => {
  afterEach(() => { setLanguagePreference('en'); vi.unstubAllGlobals(); });

  const props = () => {
    const now = Date.now();
    return {
      summaries: [
        summary('claude', 'Claude', { lastSuccessAt: now, readState: { error: null, readAt: now } }),
        summary('codex', 'Codex', { lastSuccessAt: now, readState: { error: null, readAt: now } }),
      ],
      windows: [{ ...claudeWeekly, resetAtMs: now + 48 * HOUR }, { ...codexWeekly, resetAtMs: now + 72 * HOUR }],
      display: DEFAULT_QUOTA_DISPLAY, onProviderSelect: vi.fn(), onRefresh: vi.fn(), onSettings: vi.fn(),
    };
  };

  it('renders a single remaining-quota hint', () => {
    const html = renderToStaticMarkup(<QuotaOverview {...props()} />);
    expect(html.match(/quota-headroom-hint/g)).toHaveLength(1);
    expect(html).toContain('Claude 7-day usage: 8% left. Codex still has 64% (resets ');
  });

  it('localizes the hint', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    setLanguagePreference('zh-CN');
    const html = renderToStaticMarkup(<QuotaOverview {...props()} />);
    expect(html).toContain('Claude 每周额度剩 8%；Codex 还剩 64%（');
  });
});

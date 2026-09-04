import { describe, expect, test } from 'vitest';
import {
  buildProviderSummaries,
  buildClaudeQuotaWindows,
  buildCursorQuotaWindows,
  buildGrokQuotaWindows,
  getCursorTrayUsedPercent,
  sortMostConstrained,
  sortUpcomingResets,
} from '../src/services/provider_summary';
import type { QuotaData } from '../src/types/models';

describe('provider summary helpers', () => {
  test('keeps no-data usage distinct from zero usage', () => {
    const summaries = buildProviderSummaries(
      { claude: true, codex: true, cursor: false, grok: true, antigravity: false },
      { claude: false, codex: false, cursor: false, grok: false, antigravity: true },
      { claude: null, codex: 0, cursor: null, grok: 12, antigravity: null },
    );

    expect(summaries.find((summary) => summary.id === 'claude')?.statusText).toBe('Ready');
    expect(summaries.find((summary) => summary.id === 'codex')?.statusText).toBe('0% used');
    expect(summaries.find((summary) => summary.id === 'cursor')?.statusText).toBe('Offline');
    expect(summaries.find((summary) => summary.id === 'antigravity')?.statusText).toBe('Syncing');
    expect(summaries.find((summary) => summary.id === 'grok')?.statusText).toBe('12% used');
  });

  test('builds and sorts only real quota windows', () => {
    const quota: QuotaData = {
      connected: true,
      session: { used: 1, limit: 10, percentage: 10 },
      weeklyFable5: { used: 9, limit: 10, percentage: 90 },
    };

    const windows = sortMostConstrained(buildClaudeQuotaWindows(quota));

    expect(windows.map((window) => window.label)).toEqual(['Fable 5 7-day', '5-hour usage']);
    expect(buildClaudeQuotaWindows({ connected: true })).toEqual([]);
  });

  test('sorts upcoming resets by reset time and drops unsupported rows', () => {
    const now = new Date('2026-07-04T00:00:00Z').getTime();
    const windows = buildCursorQuotaWindows({
      connected: true,
      percentage: 45,
      resetAt: '2026-07-05T00:00:00Z',
    });

    const sorted = sortUpcomingResets([
      ...windows,
      { provider: 'claude', providerLabel: 'Claude', label: 'Expired', usedPercent: 99, resetAtMs: now - 1 },
      { provider: 'codex', providerLabel: 'Codex', label: 'No reset', usedPercent: 12 },
    ], now);

    expect(sorted).toHaveLength(1);
    expect(sorted[0].provider).toBe('cursor');
  });

  test('maps Cursor dashboard bars to Cursor Models and Other Models', () => {
    const windows = buildCursorQuotaWindows({
      connected: true,
      percentage: 91.082,
      autoPercent: 2.888,
      apiPercent: 91.082,
      resetAt: '2026-09-16T15:37:22.000Z',
    });

    expect(windows.map((window) => [window.label, Math.round(window.usedPercent)])).toEqual([
      ['Cursor Models', 3],
      ['Other Models', 91],
    ]);
  });

  test('drives the Cursor tray from Cursor Models, not Other Models', () => {
    expect(getCursorTrayUsedPercent({
      connected: true,
      percentage: 100,
      autoPercent: 17,
      apiPercent: 100,
    })).toBe(17);
  });

  test('falls back to overall Cursor percentage when Cursor Models is missing', () => {
    expect(getCursorTrayUsedPercent({
      connected: true,
      percentage: 46.2,
    })).toBe(46.2);
    expect(getCursorTrayUsedPercent(null)).toBeNull();
  });

  test('uses a neutral label for summary fallback usage', () => {
    const windows = buildCursorQuotaWindows({
      connected: true,
      percentage: 25,
    });

    expect(windows[0].label).toBe('Usage');
  });

  test('preserves truthful over-limit Cursor usage in frontend summaries', () => {
    const windows = buildCursorQuotaWindows({
      connected: true,
      percentage: 130,
      resetAt: '2026-07-05T00:00:00Z',
    });
    const summaries = buildProviderSummaries(
      { claude: false, codex: false, cursor: true, grok: false, antigravity: false },
      { claude: false, codex: false, cursor: false, grok: false, antigravity: false },
      { claude: null, codex: null, cursor: 130, grok: null, antigravity: null },
    );

    expect(windows[0].usedPercent).toBe(130);
    expect(summaries.find((summary) => summary.id === 'cursor')?.statusText).toBe('130% used');
  });

  test('builds grok weekly pool and extra-credit windows', () => {
    const windows = buildGrokQuotaWindows({
      connected: true,
      percentage: 42,
      periodLabel: 'Weekly',
      resetAt: '2026-08-30T15:25:10.879112+00:00',
      products: [{ product: 'build', label: 'Build', usagePercent: 40 }],
      extra: { onDemandUsedCents: 300, onDemandCapCents: 5000, prepaidBalanceCents: 0 },
    });
    expect(windows.map((window) => window.label)).toEqual(['Weekly pool', 'Extra credits']);
    expect(windows[0].usedPercent).toBe(42);
    expect(windows[1].usedPercent).toBe(6);
    expect(buildGrokQuotaWindows({ connected: true, products: [] })).toEqual([]);
  });
});

import { describe, expect, test } from 'vitest';
import {
  buildProviderSummaries,
  buildClaudeQuotaWindows,
  buildCursorQuotaWindows,
  buildGrokQuotaWindows,
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

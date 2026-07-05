import { describe, expect, test } from 'vitest';
import {
  mergeDailySeries,
  sliceSparkDays,
  sumDailyCost,
} from '../src/components/CostSummarySection';
import type { CostDailyPoint, CostDailySeries } from '../src/types/models';

function series(source: string, days: CostDailyPoint[]): CostDailySeries {
  return {
    source,
    currency: 'USD',
    generatedAt: '2026-07-05T00:00:00Z',
    cached: false,
    days,
  };
}

function day(date: string, costUsd: number | null, totalTokens = 0): CostDailyPoint {
  return { date, cost: costUsd, costUsd, totalTokens };
}

describe('daily cost helpers', () => {
  test('merges multiple sources by date and sorts', () => {
    const merged = mergeDailySeries([
      series('claude', [day('2026-07-04', 2), day('2026-07-05', 3, 100)]),
      series('codex', [day('2026-07-05', 1.5, 50), day('2026-07-03', 4)]),
    ]);

    expect(merged.map((item) => item.date)).toEqual(['2026-07-03', '2026-07-04', '2026-07-05']);
    expect(merged[2].costUsd).toBeCloseTo(4.5);
    expect(merged[2].totalTokens).toBe(150);
  });

  test('keeps null costs null when no source has data', () => {
    const merged = mergeDailySeries([
      series('claude', [day('2026-07-05', null)]),
      series('codex', [day('2026-07-05', null)]),
    ]);
    expect(merged[0].costUsd).toBeNull();
  });

  test('slices last 7 or 30 days and sums cost', () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      day(`2026-06-${String(i + 1).padStart(2, '0')}`, 1),
    );
    expect(sliceSparkDays(days, '7d')).toHaveLength(7);
    expect(sliceSparkDays(days, '30d')).toHaveLength(30);
    expect(sumDailyCost(sliceSparkDays(days, '7d'))).toBe(7);
  });
});

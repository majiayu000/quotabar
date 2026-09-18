import { describe, expect, test } from 'vitest';
import { formatCostMoney, MERGED_COST_DISPLAY_NAME, mergeCostOverviews, nextCostRangeFontSize } from '../src/components/CostSummarySection';
import type { CostOverview, CostRangeSummary } from '../src/types/models';

function range(label: string, cost: number): CostRangeSummary {
  return {
    range: 'today',
    label,
    currency: 'USD',
    cost,
    costUsd: cost,
    tokens: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
    },
    models: [],
    validEntries: 1,
    skippedEntries: 0,
    elapsedMs: 0,
  };
}

function overview(source: 'claude' | 'codex', cost: number): CostOverview {
  return {
    source,
    displayName: source === 'claude' ? 'Claude' : 'Codex',
    currency: 'USD',
    generatedAt: '2026-09-08T00:00:00Z',
    cached: false,
    ranges: [range('Today', cost)],
  };
}

describe('merged overview cost label', () => {
  test('names Claude, Codex, and Cursor instead of All providers', () => {
    const merged = mergeCostOverviews([overview('claude', 1.5), overview('codex', 2.25)]);
    expect(merged.displayName).toBe('Claude, Codex, Cursor');
    expect(merged.displayName).toBe(MERGED_COST_DISPLAY_NAME);
    expect(merged.displayName.toLowerCase()).not.toContain('all providers');
  });
});

describe('formatCostMoney', () => {
  test('uses a narrow currency symbol so zh-CN four-digit amounts stay short', () => {
    expect(formatCostMoney(3512.34, 'USD', 'zh-CN')).toBe('$3,512.34');
    expect(formatCostMoney(3512.34, 'USD', 'zh-CN')).not.toContain('US$');
    expect(formatCostMoney(3512.34, 'USD', 'en')).toBe('$3,512.34');
  });

  test('keeps six-digit dollar amounts fully formatted', () => {
    expect(formatCostMoney(100000, 'USD', 'zh-CN')).toBe('$100,000.00');
    expect(formatCostMoney(100000, 'USD', 'en')).toBe('$100,000.00');
  });
});

describe('nextCostRangeFontSize', () => {
  test('shrinks $100,000.00 to fit a 340px tray tile', () => {
    expect(nextCostRangeFontSize(16, 81, 95)).toBeCloseTo(16 * (80 / 95));
    expect(nextCostRangeFontSize(16, 81, 95)).toBeGreaterThanOrEqual(9);
    expect(nextCostRangeFontSize(16, 81, 81)).toBeNull();
  });
});

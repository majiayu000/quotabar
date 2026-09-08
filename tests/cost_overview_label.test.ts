import { describe, expect, test } from 'vitest';
import { MERGED_COST_DISPLAY_NAME, mergeCostOverviews } from '../src/components/CostSummarySection';
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

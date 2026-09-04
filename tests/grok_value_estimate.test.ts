import { describe, expect, test } from 'vitest';
import { validateGrokValueEstimate } from '../src/services/grok_value_estimate';
import type { GrokValueEstimate } from '../src/types/models';

const NOW = Date.parse('2026-09-04T07:00:00Z');

function estimate(overrides: Partial<GrokValueEstimate> = {}): GrokValueEstimate {
  return {
    observedAt: new Date(NOW - 60_000).toISOString(),
    windowStartedAt: '2026-08-23T15:25:10.879Z',
    resetsAt: '2026-08-30T15:25:10.879Z',
    usedPct: 40,
    observedCostUsd: 12.5,
    estimatedPeriodValueUsd: 31.25,
    observedTokens: 1000,
    estimatedPeriodTokens: 2500,
    ...overrides,
  };
}

describe('validateGrokValueEstimate', () => {
  test('accepts a finite in-window estimate', () => {
    expect(validateGrokValueEstimate(estimate(), NOW)).toBeNull();
  });

  test('rejects invalid totals', () => {
    expect(validateGrokValueEstimate(estimate({ observedCostUsd: 0 }), NOW))
      .toContain('invalid totals');
  });

  test('rejects stale observation times', () => {
    expect(validateGrokValueEstimate(
      estimate({ observedAt: new Date(NOW - 11 * 60 * 1000).toISOString() }),
      NOW,
    )).toContain('stale');
  });

  test('does not compare copied official usedPct or reset fields', () => {
    expect(validateGrokValueEstimate(estimate({
      usedPct: 4,
      resetsAt: '2099-01-01T00:00:00Z',
      windowStartedAt: '1999-01-01T00:00:00Z',
    }), NOW)).toBeNull();
  });
});

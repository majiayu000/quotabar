import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import CostSummarySection from '../src/components/CostSummarySection';
import { backend } from '../src/services/backend';
import type { CostDailyPoint, CostOverview } from '../src/types/models';

const emptyTokens = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 40,
};

function overview(): CostOverview {
  return {
    source: 'claude',
    displayName: 'Claude',
    currency: 'USD',
    generatedAt: '2026-08-24T08:00:00Z',
    cached: false,
    ranges: [{
      range: 'today',
      label: 'Today',
      currency: 'USD',
      cost: null,
      costUsd: null,
      tokens: emptyTokens,
      models: [],
      validEntries: 1,
      skippedEntries: 0,
      elapsedMs: 1,
    }],
  };
}

function unpricedDay(date: string): CostDailyPoint {
  return { date, cost: null, costUsd: null, totalTokens: 40 };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const values = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('CostSummarySection missing daily cost', () => {
  it('renders unpriced days as n/a or a gap and never as $0.00', async () => {
    vi.spyOn(backend, 'getCostOverview').mockResolvedValue(overview());
    vi.spyOn(backend, 'getCostDaily').mockResolvedValue({
      source: 'claude',
      currency: 'USD',
      generatedAt: '2026-08-24T08:00:00Z',
      cached: false,
      days: Array.from({ length: 7 }, (_, index) => unpricedDay(`2026-08-${String(index + 18).padStart(2, '0')}`)),
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CostSummarySection, { source: 'claude', autoRefreshIntervalMs: 0 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const markup = JSON.stringify(renderer.toJSON());
    expect(markup).not.toContain('$0.00');
    expect(markup).toContain('n/a');
    expect(markup).toContain('spark-bar-hit gap');

    const trend = renderer.root.findByProps({ role: 'slider' });
    expect(trend.props['aria-valuetext']).toContain('n/a');
    expect(trend.props['aria-valuetext']).not.toContain('$0.00');

    await act(async () => renderer.unmount());
  });
});

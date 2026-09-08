import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, test, vi } from 'vitest';
import CostSummarySection, { formatCostCompleteness, formatCostFreshness } from '../src/components/CostSummarySection';
import { backend } from '../src/services/backend';
import type { CostOverview, CostRangeSummary } from '../src/types/models';

const tokens = {
  inputTokens: 10,
  outputTokens: 20,
  reasoningTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 30,
};

function range(overrides: Partial<CostRangeSummary> = {}): CostRangeSummary {
  return {
    range: 'today',
    label: 'Today',
    currency: 'USD',
    cost: 12,
    costUsd: 12,
    costKind: 'real',
    tokens,
    models: [],
    validEntries: 1,
    skippedEntries: 0,
    parseErrorEntries: 0,
    elapsedMs: 1,
    ...overrides,
  };
}

function overview(ranges: CostRangeSummary[]): CostOverview {
  return {
    source: 'claude',
    displayName: 'Claude',
    currency: 'USD',
    generatedAt: '2026-08-24T08:00:00Z',
    cached: false,
    ranges,
  };
}

describe('formatCostCompleteness', () => {
  test('stays empty when records are complete', () => {
    expect(formatCostCompleteness(overview([range()]))).toBe('');
  });

  test('names skipped and parse-error counts', () => {
    expect(formatCostCompleteness(overview([
      range({ skippedEntries: 3, parseErrorEntries: 2, costKind: 'estimated_proxy' }),
    ]))).toBe('3 skipped · 2 parse errors · estimated');
  });
});

describe('formatCostFreshness', () => {
  test('labels cached and stale overviews', () => {
    expect(formatCostFreshness(overview([range()]))).toBe('');
    expect(formatCostFreshness({ ...overview([range()]), cached: true })).toBe('Cached');
    expect(formatCostFreshness({ ...overview([range()]), cached: true, stale: true })).toBe('Stale');
  });
});

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

describe('CostSummarySection completeness footer', () => {
  it('shows skipped and parse-error counts in the cost footer', async () => {
    vi.spyOn(backend, 'getCostOverview').mockResolvedValue(overview([
      range({ skippedEntries: 4, parseErrorEntries: 1, costKind: 'estimated_proxy' }),
    ]));
    vi.spyOn(backend, 'getCostDaily').mockResolvedValue({
      source: 'claude',
      currency: 'USD',
      generatedAt: '2026-08-24T08:00:00Z',
      cached: false,
      days: [],
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CostSummarySection, { source: 'claude', autoRefreshIntervalMs: 0, showTrend: false }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const markup = JSON.stringify(renderer.toJSON());
    expect(markup).toContain('4 skipped');
    expect(markup).toContain('1 parse errors');
    expect(markup).toContain('estimated');
    await act(async () => renderer.unmount());
  });

  it('labels cached and stale overviews instead of presenting them as live', async () => {
    vi.spyOn(backend, 'getCostOverview').mockResolvedValue({
      ...overview([range()]),
      cached: true,
      stale: true,
    });
    vi.spyOn(backend, 'getCostDaily').mockResolvedValue({
      source: 'claude',
      currency: 'USD',
      generatedAt: '2026-08-24T08:00:00Z',
      cached: true,
      stale: true,
      days: [],
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CostSummarySection, { source: 'claude', autoRefreshIntervalMs: 0, showTrend: false }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const markup = JSON.stringify(renderer.toJSON());
    expect(markup).toContain('Stale');
    expect(markup).not.toContain('Cached');
    await act(async () => renderer.unmount());
  });

  it('labels a cache hit as Cached', async () => {
    vi.spyOn(backend, 'getCostOverview').mockResolvedValue({
      ...overview([range()]),
      cached: true,
      stale: false,
    });
    vi.spyOn(backend, 'getCostDaily').mockResolvedValue({
      source: 'claude',
      currency: 'USD',
      generatedAt: '2026-08-24T08:00:00Z',
      cached: true,
      days: [],
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CostSummarySection, { source: 'claude', autoRefreshIntervalMs: 0, showTrend: false }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('Cached');
    await act(async () => renderer.unmount());
  });
});

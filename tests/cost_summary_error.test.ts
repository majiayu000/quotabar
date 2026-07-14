import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getCostSummaryErrorMessage,
  startCostSummaryAutoRefresh,
} from '../src/components/CostSummarySection';

describe('getCostSummaryErrorMessage', () => {
  test('preserves string errors returned by Tauri commands', () => {
    expect(getCostSummaryErrorMessage('ccstats failed to parse local usage')).toBe(
      'ccstats failed to parse local usage',
    );
  });

  test('falls back only for empty or unknown errors', () => {
    expect(getCostSummaryErrorMessage('')).toBe('Failed to load cost summary');
    expect(getCostSummaryErrorMessage(null)).toBe('Failed to load cost summary');
  });
});

describe('startCostSummaryAutoRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('refreshes with force enabled on interval ticks', () => {
    vi.useFakeTimers();
    const loadCost = vi.fn();
    const interval = startCostSummaryAutoRefresh(1000, loadCost);

    vi.advanceTimersByTime(1000);

    expect(loadCost).toHaveBeenCalledTimes(1);
    expect(loadCost).toHaveBeenCalledWith(true);
    if (interval !== undefined) clearInterval(interval);
  });

  test('stops refreshing after interval cleanup', () => {
    vi.useFakeTimers();
    const loadCost = vi.fn();
    const interval = startCostSummaryAutoRefresh(1000, loadCost);

    vi.advanceTimersByTime(1000);
    if (interval !== undefined) clearInterval(interval);
    vi.advanceTimersByTime(1000);

    expect(loadCost).toHaveBeenCalledTimes(1);
  });
});

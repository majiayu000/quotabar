import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import OverviewPanel from '../src/components/OverviewPanel';
import { backend } from '../src/services/backend';
import type { CostDailySeries, CostOverview } from '../src/types/models';

const overview: CostOverview = {
  source: 'claude',
  displayName: 'Claude',
  currency: 'USD',
  generatedAt: '2026-08-25T00:00:00Z',
  cached: false,
  ranges: [],
};

const daily: CostDailySeries = {
  source: 'claude',
  currency: 'USD',
  generatedAt: '2026-08-25T00:00:00Z',
  cached: false,
  days: [],
};

function panel(showCostSummary: boolean) {
  return createElement(OverviewPanel, {
    summaries: [],
    mostConstrained: [],
    upcomingResets: [],
    costRefreshKey: 0,
    showCostSummary,
    onProviderSelect: vi.fn(),
    sections: { timeline: false, cost: true, trend: false, tips: false },
  });
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.spyOn(backend, 'getCostOverview').mockResolvedValue(overview);
  vi.spyOn(backend, 'getCostDaily').mockResolvedValue(daily);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

describe('Overview cost visibility lifecycle', () => {
  it('mounts cost work only while the popover is visible', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(panel(false));
    });
    expect(backend.getCostOverview).not.toHaveBeenCalled();
    expect(backend.getCostDaily).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      renderer.update(panel(true));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(backend.getCostOverview).toHaveBeenCalledTimes(3);
    expect(backend.getCostDaily).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      renderer.update(panel(false));
    });
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => renderer.unmount());
  });
});

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CostSummarySection from '../src/components/CostSummarySection';
import { backend } from '../src/services/backend';
import type { CostDailySeries, CostOverview } from '../src/types/models';

function cost_overview(): CostOverview {
  return {
    source: 'claude',
    displayName: 'Claude',
    currency: 'USD',
    generatedAt: '2026-07-16T00:00:00Z',
    cached: false,
    ranges: [],
  };
}

function cost_daily(): CostDailySeries {
  return {
    source: 'claude',
    currency: 'USD',
    generatedAt: '2026-07-16T00:00:00Z',
    cached: false,
    days: [],
  };
}

describe('CostSummarySection manual-refresh force flag', () => {
  let overview_forces: Array<boolean | undefined>;
  let daily_forces: Array<boolean | undefined>;
  let renderer: ReactTestRenderer;

  beforeAll(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    const values = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };
    overview_forces = [];
    daily_forces = [];
    vi.spyOn(backend, 'getCostOverview').mockImplementation(async (_source, force) => {
      overview_forces.push(force);
      return cost_overview();
    });
    vi.spyOn(backend, 'getCostDaily').mockImplementation(async (_source, _days, force) => {
      daily_forces.push(force);
      return cost_daily();
    });
  });

  afterEach(async () => {
    await act(async () => renderer.unmount());
    vi.restoreAllMocks();
  });

  async function render(refreshKey: number, autoRefreshIntervalMs = 0): Promise<void> {
    await act(async () => {
      renderer = create(
        createElement(CostSummarySection, { source: 'claude', refreshKey, autoRefreshIntervalMs }),
      );
    });
  }

  async function update(refreshKey: number, autoRefreshIntervalMs = 0): Promise<void> {
    await act(async () => {
      renderer.update(
        createElement(CostSummarySection, { source: 'claude', refreshKey, autoRefreshIntervalMs }),
      );
    });
  }

  it('loads without force on mount', async () => {
    await render(0);
    expect(overview_forces).toEqual([false]);
    expect(daily_forces).toEqual([false]);
  });

  it('forces only when the refresh nonce advances', async () => {
    await render(0);
    await update(1);
    expect(overview_forces).toEqual([false, true]);
    expect(daily_forces).toEqual([false, true]);
  });

  it('does not keep forcing after a manual refresh when the effect reruns', async () => {
    await render(0);
    await update(1);
    // Same nonce, different interval: the effect reruns but this is not a
    // manual refresh, so the backend cache must be used.
    await update(1, 1000);
    expect(overview_forces).toEqual([false, true, false]);
    expect(daily_forces).toEqual([false, true, false]);
  });
});

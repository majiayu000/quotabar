import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import App from '../src/App';
import AntigravityPanel from '../src/components/AntigravityPanel';
import CodexPanel from '../src/components/CodexPanel';
import CostSummarySection from '../src/components/CostSummarySection';
import CursorPanel from '../src/components/CursorPanel';
import { backend } from '../src/services/backend';
import type {
  AntigravityData,
  CodexData,
  CodexRateLimits,
  CodexResetCredits,
  CostDailySeries,
  CostOverview,
  CursorData,
  QuotaData,
} from '../src/types/models';

vi.mock('../src/hooks/use_popover_window', () => ({
  usePopoverWindow: () => false,
}));

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (reason: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolve_promise, reject_promise) => {
    resolve = resolve_promise;
    reject = reject_promise;
  });
  return { promise, reject, resolve };
}

async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount());
}

function rendered_text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

interface PanelCallbacks {
  connection: Mock;
  loading: Mock;
  quota_windows: Mock;
  usage: Mock;
}

function panel_callbacks(): PanelCallbacks {
  return {
    connection: vi.fn(),
    loading: vi.fn(),
    quota_windows: vi.fn(),
    usage: vi.fn(),
  };
}

interface PanelRequests {
  reject(index: number, reason: unknown): void;
  resolve(index: number, marker: number): void;
}

interface PanelDriver {
  expected_failure_marker: boolean | null;
  marker(callbacks: PanelCallbacks): Array<boolean | number | null>;
  name: string;
  render(nonce: number, callbacks: PanelCallbacks): ReactElement;
  requests(): PanelRequests;
}

function cursor_requests(): PanelRequests {
  const active: Deferred<CursorData>[] = [];
  vi.spyOn(backend, 'getCursorInfo').mockImplementation(() => {
    const request = deferred<CursorData>();
    active.push(request);
    return request.promise;
  });
  return {
    reject: (index, reason) => active[index].reject(reason),
    resolve: (index, marker) => active[index].resolve({ connected: true, percentage: marker }),
  };
}

interface CodexBundle {
  credits: Deferred<CodexResetCredits>;
  info: Deferred<CodexData>;
  limits: Deferred<CodexRateLimits>;
}

function codex_requests(): PanelRequests & { reject_member(index: number, member: keyof CodexBundle, reason: unknown): void } {
  const bundles: CodexBundle[] = [];
  const get_bundle = (index: number) => {
    while (bundles.length <= index) {
      bundles.push({
        credits: deferred<CodexResetCredits>(),
        info: deferred<CodexData>(),
        limits: deferred<CodexRateLimits>(),
      });
    }
    return bundles[index];
  };
  let info_index = 0;
  let limits_index = 0;
  let credits_index = 0;
  vi.spyOn(backend, 'getCodexInfo').mockImplementation(() => get_bundle(info_index++).info.promise);
  vi.spyOn(backend, 'getCodexRateLimits').mockImplementation(() => get_bundle(limits_index++).limits.promise);
  vi.spyOn(backend, 'getCodexResetCredits').mockImplementation(() => get_bundle(credits_index++).credits.promise);
  return {
    reject: (index, reason) => get_bundle(index).info.reject(reason),
    reject_member: (index, member, reason) => get_bundle(index)[member].reject(reason),
    resolve: (index, marker) => {
      const bundle = get_bundle(index);
      bundle.info.resolve({ connected: true });
      bundle.limits.resolve({ connected: true, secondary: { usedPercent: marker } });
      bundle.credits.resolve({ connected: true, availableCount: 0, credits: [] });
    },
  };
}

function antigravity_requests(): PanelRequests {
  const active: Array<Deferred<AntigravityData>> = [];
  vi.spyOn(backend, 'getAntigravityInfo').mockImplementation(() => {
    const request = deferred<AntigravityData>();
    active.push(request);
    return request.promise;
  });
  return {
    reject: (index, reason) => active[index].reject(reason),
    resolve: (index, marker) => active[index].resolve({ connected: marker === 20, status: `status-${marker}` }),
  };
}

const panel_drivers: PanelDriver[] = [
  {
    name: 'Codex',
    expected_failure_marker: null,
    requests: codex_requests,
    marker: (callbacks) => callbacks.usage.mock.calls.map(([value]) => value),
    render: (nonce, callbacks) => createElement(CodexPanel, {
      autoRefreshIntervalMs: 0,
      manualRefreshNonce: nonce,
      onConnectionChange: callbacks.connection,
      onLoadingChange: callbacks.loading,
      onQuotaWindowsChange: callbacks.quota_windows,
      onUsageChange: callbacks.usage,
      showCostSummary: false,
    }),
  },
  {
    name: 'Cursor',
    expected_failure_marker: null,
    requests: cursor_requests,
    marker: (callbacks) => callbacks.usage.mock.calls.map(([value]) => value),
    render: (nonce, callbacks) => createElement(CursorPanel, {
      autoRefreshIntervalMs: 0,
      manualRefreshNonce: nonce,
      onConnectionChange: callbacks.connection,
      onLoadingChange: callbacks.loading,
      onQuotaWindowsChange: callbacks.quota_windows,
      onUsageChange: callbacks.usage,
      showCostSummary: false,
    }),
  },
  {
    name: 'Antigravity',
    expected_failure_marker: false,
    requests: antigravity_requests,
    marker: (callbacks) => callbacks.connection.mock.calls.map(([value]) => value),
    render: (nonce, callbacks) => createElement(AntigravityPanel, {
      autoRefreshIntervalMs: 0,
      manualRefreshNonce: nonce,
      onConnectionChange: callbacks.connection,
      onLoadingChange: callbacks.loading,
    }),
  },
];

async function start_panel_race(driver: PanelDriver) {
  const requests = driver.requests();
  const callbacks = panel_callbacks();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(driver.render(0, callbacks));
  });
  await act(async () => {
    renderer.update(driver.render(1, callbacks));
  });
  return { callbacks, renderer, requests };
}

describe.each(panel_drivers)('$name latest request wins', (driver) => {
  it('keeps new success after old success', async () => {
    const race = await start_panel_race(driver);
    await settle(() => race.requests.resolve(1, 20));
    await settle(() => race.requests.resolve(0, 90));
    expect(driver.marker(race.callbacks)).toEqual([driver.name === 'Antigravity' ? true : 20]);
    expect(race.callbacks.loading.mock.calls.at(-1)?.[0]).toBe(false);
    await unmount(race.renderer);
  });

  it('keeps new success after old failure', async () => {
    const race = await start_panel_race(driver);
    await settle(() => race.requests.resolve(1, 20));
    await settle(() => race.requests.reject(0, new Error('old failure')));
    expect(driver.marker(race.callbacks)).toEqual([driver.name === 'Antigravity' ? true : 20]);
    expect(rendered_text(race.renderer)).not.toContain('old failure');
    await unmount(race.renderer);
  });

  it('keeps new failure after old success', async () => {
    const race = await start_panel_race(driver);
    await settle(() => race.requests.reject(1, new Error('new failure')));
    await settle(() => race.requests.resolve(0, 90));
    expect(driver.marker(race.callbacks)).toEqual([driver.expected_failure_marker]);
    expect(rendered_text(race.renderer)).toContain('new failure');
    await unmount(race.renderer);
  });

  it('does not let stale finally finish current loading', async () => {
    const race = await start_panel_race(driver);
    await settle(() => race.requests.resolve(0, 90));
    expect(race.callbacks.loading.mock.calls.at(-1)?.[0]).toBe(true);
    expect(driver.marker(race.callbacks)).toEqual([]);
    await settle(() => race.requests.resolve(1, 20));
    expect(race.callbacks.loading.mock.calls.at(-1)?.[0]).toBe(false);
    await unmount(race.renderer);
  });

  it('suppresses completion after unmount', async () => {
    const requests = driver.requests();
    const callbacks = panel_callbacks();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(driver.render(0, callbacks));
    });
    await unmount(renderer);
    await settle(() => requests.resolve(0, 90));
    expect(driver.marker(callbacks)).toEqual([]);
  });
});

describe('Codex atomic bundle failures', () => {
  for (const member of ['info', 'limits', 'credits'] as const) {
    it(`surfaces current ${member} rejection`, async () => {
      const requests = codex_requests();
      const callbacks = panel_callbacks();
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(panel_drivers[0].render(0, callbacks));
      });
      await settle(() => requests.reject_member(0, member, new Error(`current ${member} failure`)));
      expect(callbacks.usage).toHaveBeenCalledWith(null);
      expect(callbacks.connection).toHaveBeenCalledWith(false);
      expect(callbacks.quota_windows).toHaveBeenCalledWith([]);
      expect(rendered_text(renderer)).toContain(`current ${member} failure`);
      await unmount(renderer);
    });

    it(`suppresses stale ${member} rejection`, async () => {
      const race = await start_panel_race(panel_drivers[0]);
      const requests = race.requests as ReturnType<typeof codex_requests>;
      await settle(() => requests.resolve(1, 20));
      await settle(() => requests.reject_member(0, member, new Error(`old ${member} failure`)));
      expect(race.callbacks.usage.mock.calls.map(([value]) => value)).toEqual([20]);
      expect(rendered_text(race.renderer)).not.toContain(`old ${member} failure`);
      await unmount(race.renderer);
    });
  }
});

function install_app_backend(quota_requests: Array<Deferred<QuotaData>>): void {
  vi.spyOn(backend, 'getQuota').mockImplementation(() => quota_requests.shift()!.promise);
  vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({ connected: true, availableCount: 0, credits: [] });
  vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getAntigravityInfo').mockResolvedValue({ connected: false, status: 'pending' });
  vi.spyOn(backend, 'setDockVisibility').mockResolvedValue(undefined);
  vi.spyOn(backend, 'updateTrayIcon').mockResolvedValue(undefined);
}

function quota(marker: number): QuotaData {
  return {
    connected: true,
    weeklyTotal: { used: marker, limit: 100, percentage: marker },
  };
}

async function start_claude_race() {
  vi.useFakeTimers();
  const old_request = deferred<QuotaData>();
  const new_request = deferred<QuotaData>();
  install_app_backend([old_request, new_request]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(App));
    await Promise.resolve();
  });
  const refresh = renderer.root.findByProps({ 'aria-label': 'Refresh current provider' });
  await act(async () => refresh.props.onClick());
  return { new_request, old_request, renderer };
}

describe('Claude latest request wins', () => {
  it('keeps new success after old success', async () => {
    const race = await start_claude_race();
    await settle(() => race.new_request.resolve(quota(20)));
    await settle(() => race.old_request.resolve(quota(90)));
    expect(rendered_text(race.renderer)).toContain('20%');
    expect(rendered_text(race.renderer)).not.toContain('90%');
    await unmount(race.renderer);
  });

  it('keeps new success after old failure', async () => {
    const race = await start_claude_race();
    await settle(() => race.new_request.resolve(quota(20)));
    await settle(() => race.old_request.reject(new Error('old Claude failure')));
    expect(rendered_text(race.renderer)).toContain('20%');
    expect(rendered_text(race.renderer)).not.toContain('old Claude failure');
    await unmount(race.renderer);
  });

  it('keeps new failure after old success', async () => {
    const race = await start_claude_race();
    await settle(() => race.new_request.reject(new Error('new Claude failure')));
    await settle(() => race.old_request.resolve(quota(90)));
    expect(rendered_text(race.renderer)).toContain('new Claude failure');
    expect(rendered_text(race.renderer)).not.toContain('90%');
    await unmount(race.renderer);
  });

  it('does not let stale finally finish current loading', async () => {
    const race = await start_claude_race();
    await settle(() => race.old_request.resolve(quota(90)));
    expect(rendered_text(race.renderer)).toContain('Loading Claude quota');
    await settle(() => race.new_request.resolve(quota(20)));
    expect(rendered_text(race.renderer)).toContain('20%');
    await unmount(race.renderer);
  });

  it('invalidates a startup request on unmount', async () => {
    vi.useFakeTimers();
    const request = deferred<QuotaData>();
    install_app_backend([request]);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(App));
      await Promise.resolve();
    });
    await unmount(renderer);
    await settle(() => request.resolve(quota(90)));
    expect(vi.getTimerCount()).toBe(0);
  });
});

function cost_overview(marker: number): CostOverview {
  return {
    source: 'claude',
    displayName: 'Claude',
    currency: 'USD',
    generatedAt: '2026-07-16T00:00:00Z',
    cached: false,
    ranges: [{
      range: 'today',
      label: 'Today',
      currency: 'USD',
      cost: marker,
      costUsd: marker,
      tokens: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: marker },
      models: [],
      validEntries: 1,
      skippedEntries: 0,
      elapsedMs: 1,
    }],
  };
}

function cost_daily(marker: number): CostDailySeries {
  return {
    source: 'claude',
    currency: 'USD',
    generatedAt: '2026-07-16T00:00:00Z',
    cached: false,
    days: [{ date: '2026-07-16', cost: marker, costUsd: marker, totalTokens: marker }],
  };
}

function cost_requests() {
  const overviews: Array<Deferred<CostOverview>> = [];
  const dailies: Array<Deferred<CostDailySeries>> = [];
  vi.spyOn(backend, 'getCostOverview').mockImplementation(() => {
    const request = deferred<CostOverview>();
    overviews.push(request);
    return request.promise;
  });
  vi.spyOn(backend, 'getCostDaily').mockImplementation(() => {
    const request = deferred<CostDailySeries>();
    dailies.push(request);
    return request.promise;
  });
  return { dailies, overviews };
}

async function start_cost_race() {
  vi.useFakeTimers();
  const requests = cost_requests();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(CostSummarySection, { source: 'claude', autoRefreshIntervalMs: 1000 }));
  });
  await act(async () => vi.advanceTimersByTime(1000));
  expect(requests.overviews).toHaveLength(2);
  expect(requests.dailies).toHaveLength(2);
  return { renderer, requests };
}

describe('Cost lane latest request wins', () => {
  it('keeps overview new success after old success and failure', async () => {
    for (const old_terminal of ['success', 'failure'] as const) {
      const race = await start_cost_race();
      await settle(() => race.requests.overviews[1].resolve(cost_overview(20)));
      if (old_terminal === 'success') await settle(() => race.requests.overviews[0].resolve(cost_overview(90)));
      else await settle(() => race.requests.overviews[0].reject(new Error('old overview failure')));
      expect(rendered_text(race.renderer)).toContain('$20.00');
      expect(rendered_text(race.renderer)).not.toContain('$90.00');
      await unmount(race.renderer);
      vi.useRealTimers();
    }
  });

  it('keeps overview new failure after old success', async () => {
    const race = await start_cost_race();
    await settle(() => race.requests.overviews[1].reject(new Error('new overview failure')));
    await settle(() => race.requests.overviews[0].resolve(cost_overview(90)));
    expect(rendered_text(race.renderer)).toContain('new overview failure');
    expect(rendered_text(race.renderer)).not.toContain('$90.00');
    await unmount(race.renderer);
  });

  it('does not let overview stale finally finish current loading', async () => {
    const race = await start_cost_race();
    await settle(() => race.requests.overviews[0].resolve(cost_overview(90)));
    expect(rendered_text(race.renderer)).toContain('Loading cost');
    await settle(() => race.requests.overviews[1].resolve(cost_overview(20)));
    expect(rendered_text(race.renderer)).toContain('$20.00');
    await unmount(race.renderer);
  });

  it('keeps daily new success after old success and failure', async () => {
    for (const old_terminal of ['success', 'failure'] as const) {
      const race = await start_cost_race();
      await settle(() => race.requests.overviews[1].resolve(cost_overview(20)));
      await settle(() => race.requests.dailies[1].resolve(cost_daily(2)));
      const console_error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      if (old_terminal === 'success') await settle(() => race.requests.dailies[0].resolve(cost_daily(9)));
      else await settle(() => race.requests.dailies[0].reject(new Error('old daily failure')));
      expect(rendered_text(race.renderer)).toContain('Past 7 days · $2.00');
      expect(rendered_text(race.renderer)).not.toContain('$9.00');
      expect(console_error).not.toHaveBeenCalled();
      await unmount(race.renderer);
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('keeps daily new failure after old success', async () => {
    const race = await start_cost_race();
    await settle(() => race.requests.overviews[1].resolve(cost_overview(20)));
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await settle(() => race.requests.dailies[1].reject(new Error('new daily failure')));
    await settle(() => race.requests.dailies[0].resolve(cost_daily(9)));
    expect(console_error).toHaveBeenCalledWith('Failed to load daily cost series:', expect.any(Error));
    expect(rendered_text(race.renderer)).not.toContain('Past 7 days');
    await unmount(race.renderer);
  });

  it('commits overview and daily current requests independently', async () => {
    const race = await start_cost_race();
    await settle(() => race.requests.overviews[1].resolve(cost_overview(20)));
    await settle(() => race.requests.dailies[1].resolve(cost_daily(2)));
    expect(rendered_text(race.renderer)).toContain('$20.00');
    expect(rendered_text(race.renderer)).toContain('Past 7 days · $2.00');
    await unmount(race.renderer);
  });

  it('suppresses both lane completions after cleanup', async () => {
    vi.useFakeTimers();
    const requests = cost_requests();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CostSummarySection, { source: 'claude', autoRefreshIntervalMs: 0 }));
    });
    await unmount(renderer);
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await settle(() => requests.overviews[0].resolve(cost_overview(90)));
    await settle(() => requests.dailies[0].reject(new Error('cleanup daily failure')));
    expect(console_error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Antigravity polling pause', () => {
  it('does not register a timer when interval is zero', async () => {
    vi.useFakeTimers();
    const requests = antigravity_requests();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(AntigravityPanel, { autoRefreshIntervalMs: 0 }));
    });
    expect(vi.getTimerCount()).toBe(0);
    await unmount(renderer);
    await settle(() => requests.resolve(0, 20));
  });
});

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).localStorage;
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { backend } from '../src/services/backend';
import { SERVICES } from '../src/services/service_meta';
import type { TrayServiceName } from '../src/services/tray_visibility';
import type { QuotaData } from '../src/types/models';

vi.mock('../src/hooks/use_popover_window', () => ({
  usePopoverWindow: () => false,
}));

import App from '../src/App';

function memoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

async function render_app(workspace = false): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(App, { workspace }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount());
}

function visible_calls(update: ReturnType<typeof vi.spyOn>) {
  const visible = new Map<TrayServiceName, boolean>();
  for (const args of update.mock.calls) {
    const service = args[0] as TrayServiceName;
    visible.set(service, args[2] as boolean);
  }
  return visible;
}

function quota_with_percent(percentage: number): QuotaData {
  return {
    connected: true,
    weeklyTotal: { used: percentage, limit: 100, percentage },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function claude_visible_calls(): unknown[][] {
  return (backend.updateTrayIcon as unknown as Mock).mock.calls.filter(
    (args) => args[0] === 'claude' && args[2] === true,
  );
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).localStorage = memoryStorage({
    'claude-tray-enabled': 'false',
    'codex-tray-enabled': 'true',
    'cursor-tray-enabled': 'false',
    'grok-tray-enabled': 'true',
    'antigravity-tray-enabled': 'false',
    'claude-quota-tray-cycle': 'false',
  });

  vi.spyOn(backend, 'getQuota').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({
    connected: true,
    availableCount: 0,
    credits: [],
  });
  vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
  vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getGrokInfo').mockResolvedValue({ connected: true, percentage: 39, products: [] });
  vi.spyOn(backend, 'getAntigravityInfo').mockResolvedValue({ connected: false, status: 'pending' });
  vi.spyOn(backend, 'setDockVisibility').mockResolvedValue(undefined);
  vi.spyOn(backend, 'updateTrayIcon').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).localStorage;
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

describe('tray icon sync', () => {
  test('the independent workspace never rewrites background tray icons or Dock preferences', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [], diagnostics: [] });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('all');
    vi.spyOn(backend, 'analysisReport').mockResolvedValue({ summaries: [], projects: [], history: [], errors: [] });
    const renderer = await render_app(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(backend.updateTrayIcon).not.toHaveBeenCalled();
    expect(backend.setDockVisibility).not.toHaveBeenCalled();
    await unmount(renderer);
  });

  test('keeps every enabled provider tray visible when cycle is off', async () => {
    const renderer = await render_app();
    const visible = visible_calls(backend.updateTrayIcon as unknown as ReturnType<typeof vi.spyOn>);

    expect(visible.get('codex')).toBe(true);
    expect(visible.get('grok')).toBe(true);
    expect(visible.get('claude')).toBe(false);
    expect(visible.get('cursor')).toBe(false);
    expect(visible.get('antigravity')).toBe(false);
    expect(SERVICES.every((service) => visible.has(service))).toBe(true);

    await unmount(renderer);
  });

  test('ignores a slower tray IPC completion so the skip-cache keeps the newer tuple', async () => {
    (globalThis as Record<string, unknown>).localStorage = memoryStorage({
      'claude-tray-enabled': 'true',
      'codex-tray-enabled': 'false',
      'cursor-tray-enabled': 'false',
      'grok-tray-enabled': 'false',
      'antigravity-tray-enabled': 'false',
      'claude-quota-tray-cycle': 'false',
    });

    const hung = () => new Promise<never>(() => {});
    vi.spyOn(backend, 'getCodexInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexRateLimits').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexResetCredits').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexWeeklyQuota').mockImplementation(hung);
    vi.spyOn(backend, 'getCursorInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getGrokInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getAntigravityInfo').mockImplementation(hung);

    let quotaPercent = 10;
    vi.spyOn(backend, 'getQuota').mockImplementation(async () => quota_with_percent(quotaPercent));

    const inflight: Array<{ percentage: number | null; resolve(): void }> = [];
    vi.spyOn(backend, 'updateTrayIcon').mockImplementation((service, percentage, visible) => {
      if (service !== 'claude' || !visible || percentage == null) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        inflight.push({
          percentage,
          resolve: () => resolve(undefined),
        });
      });
    });

    const renderer = await render_app();
    await flush();
    await flush();

    expect(inflight.length).toBeGreaterThan(0);
    expect(inflight.every((call) => call.percentage === 10)).toBe(true);

    quotaPercent = 20;
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Refresh current provider' }).props.onClick();
    });
    await flush();
    await flush();

    const newer = inflight.filter((call) => call.percentage === 20);
    expect(newer.length).toBeGreaterThan(0);
    const latest = inflight[inflight.length - 1];
    expect(latest.percentage).toBe(20);

    await act(async () => {
      latest.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    for (const call of inflight.slice(0, -1)) {
      await act(async () => {
        call.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    const callsAfterRace = claude_visible_calls().length;

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Refresh current provider' }).props.onClick();
    });
    await flush();
    await flush();

    expect(claude_visible_calls()).toHaveLength(callsAfterRace);

    await unmount(renderer);
  });

  test('keeps the user tray style and marks a stale Claude percent as last known', async () => {
    (globalThis as Record<string, unknown>).localStorage = memoryStorage({
      'claude-tray-enabled': 'true',
      'codex-tray-enabled': 'false',
      'cursor-tray-enabled': 'false',
      'grok-tray-enabled': 'false',
      'antigravity-tray-enabled': 'false',
      'claude-quota-tray-cycle': 'false',
    });

    const hung = () => new Promise<never>(() => {});
    vi.spyOn(backend, 'getCodexInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexRateLimits').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexResetCredits').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexWeeklyQuota').mockImplementation(hung);
    vi.spyOn(backend, 'getCursorInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getGrokInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getAntigravityInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getQuota').mockResolvedValue({
      ...quota_with_percent(42),
      error: 'API error: 429 Too Many Requests',
    });

    const renderer = await render_app();
    await flush();
    await flush();

    const staleCall = claude_visible_calls().find((args) => args[1] === 42);
    expect(staleCall).toBeDefined();
    expect(staleCall?.[4]).toBe('percent');
    expect(staleCall?.[5]).toBe(true);

    await unmount(renderer);
  });

  test('marks Cursor last-known percents stale when the DTO still carries an error', async () => {
    (globalThis as Record<string, unknown>).localStorage = memoryStorage({
      'claude-tray-enabled': 'false',
      'codex-tray-enabled': 'false',
      'cursor-tray-enabled': 'true',
      'grok-tray-enabled': 'false',
      'antigravity-tray-enabled': 'false',
      'claude-quota-tray-cycle': 'false',
    });

    const hung = () => new Promise<never>(() => {});
    vi.spyOn(backend, 'getCodexInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexRateLimits').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexResetCredits').mockImplementation(hung);
    vi.spyOn(backend, 'getCodexWeeklyQuota').mockImplementation(hung);
    vi.spyOn(backend, 'getGrokInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getAntigravityInfo').mockImplementation(hung);
    vi.spyOn(backend, 'getQuota').mockImplementation(hung);
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({
      connected: true,
      percentage: 22,
      error: 'Network error: timed out',
    });

    const renderer = await render_app();
    await flush();
    await flush();

    const staleCall = (backend.updateTrayIcon as unknown as Mock).mock.calls.find(
      (args) => args[0] === 'cursor' && args[2] === true && args[1] === 22,
    );
    expect(staleCall).toBeDefined();
    expect(staleCall?.[4]).toBe('percent');
    expect(staleCall?.[5]).toBe(true);

    await unmount(renderer);
  });
});

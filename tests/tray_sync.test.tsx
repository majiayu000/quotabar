import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { backend } from '../src/services/backend';
import { SERVICES } from '../src/services/service_meta';
import type { TrayServiceName } from '../src/services/tray_visibility';

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
});

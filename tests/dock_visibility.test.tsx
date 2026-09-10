import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import SettingsView from '../src/components/SettingsView';
import { backend } from '../src/services/backend';
import { DOCK_HIDDEN_KEY } from '../src/services/app_state';

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

function mockQuotaBackends(): void {
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
  vi.spyOn(backend, 'updateTrayIcon').mockResolvedValue(undefined);
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).localStorage = memoryStorage({
    'claude-quota-settings-expanded': 'true',
  });
  mockQuotaBackends();
  vi.spyOn(backend, 'getDockVisibility').mockResolvedValue(true);
  vi.spyOn(backend, 'setDockVisibility').mockResolvedValue(undefined);
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

describe('Hide Dock preference', () => {
  test('hydrates the tray from the native file and does not write native on mount', async () => {
    vi.mocked(backend.getDockVisibility).mockResolvedValue(false);
    const renderer = await render_app();

    expect(backend.getDockVisibility).toHaveBeenCalled();
    expect(backend.setDockVisibility).not.toHaveBeenCalled();
    expect(renderer.root.findByType(SettingsView).props.dockHidden).toBe(true);
    expect(localStorage.getItem(DOCK_HIDDEN_KEY)).toBe('true');
    await unmount(renderer);
  });

  test('does not overwrite a hidden native preference with a missing localStorage default', async () => {
    vi.mocked(backend.getDockVisibility).mockResolvedValue(false);
    expect(localStorage.getItem(DOCK_HIDDEN_KEY)).toBeNull();
    const renderer = await render_app();

    expect(backend.setDockVisibility).not.toHaveBeenCalled();
    expect(renderer.root.findByType(SettingsView).props.dockHidden).toBe(true);
    await unmount(renderer);
  });

  test('writes native only after an explicit Hide Dock toggle', async () => {
    const renderer = await render_app();
    expect(backend.setDockVisibility).not.toHaveBeenCalled();

    await act(async () => {
      renderer.root.findByType(SettingsView).props.onDockToggle();
      await Promise.resolve();
    });

    expect(backend.setDockVisibility).toHaveBeenCalledTimes(1);
    expect(backend.setDockVisibility).toHaveBeenCalledWith(false);
    expect(renderer.root.findByType(SettingsView).props.dockHidden).toBe(true);
    expect(localStorage.getItem(DOCK_HIDDEN_KEY)).toBe('true');
    await unmount(renderer);
  });

  test('keeps the previous Hide Dock value when native persist fails', async () => {
    vi.mocked(backend.setDockVisibility).mockRejectedValue(new Error('persist failed'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderer = await render_app();

    await act(async () => {
      renderer.root.findByType(SettingsView).props.onDockToggle();
      await Promise.resolve();
    });

    expect(renderer.root.findByType(SettingsView).props.dockHidden).toBe(false);
    expect(localStorage.getItem(DOCK_HIDDEN_KEY)).toBe('false');
    await unmount(renderer);
  });

  test('the independent workspace never reads or writes Dock preferences', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [], diagnostics: [] });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('all');
    vi.spyOn(backend, 'analysisReport').mockResolvedValue({
      summaries: [],
      projects: [],
      history: [],
      errors: [],
    });
    const renderer = await render_app(true);
    expect(backend.getDockVisibility).not.toHaveBeenCalled();
    expect(backend.setDockVisibility).not.toHaveBeenCalled();
    await unmount(renderer);
  });
});

import { createElement, StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import SettingsView from '../src/components/SettingsView';
import TabSwitcher from '../src/components/TabSwitcher';
import { backend } from '../src/services/backend';
import { SERVICES } from '../src/services/service_meta';
import {
  saveSwitcherVisibility,
  type SwitcherVisibility,
} from '../src/services/switcher_providers';
import type { TrayServiceName } from '../src/services/tray_visibility';
import {
  STORAGE_WRITE_FAILURE_MESSAGE,
  type StorageReadResult,
} from '../src/services/storage';
import { TRAY_GUARD_TOAST_MS } from '../src/services/app_state';

const SWITCHER_GUARD_MESSAGE = 'At least one provider must stay in the switcher';

const harness = vi.hoisted(() => ({
  initial_visibility: {
    antigravity: false,
    claude: true,
    codex: false,
    cursor: false,
  },
  saved_tab: 'all',
  settings_expanded: true,
  save_visibility: vi.fn(() => true),
  write_failure_listener: null as (() => void) | null,
}));

vi.mock('../src/hooks/use_popover_window', () => ({
  usePopoverWindow: () => false,
}));

vi.mock('../src/services/app_state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/app_state')>();
  return {
    ...actual,
    getSavedSettingsExpanded: () => harness.settings_expanded,
    getSavedTab: () => harness.saved_tab,
  };
});

vi.mock('../src/services/switcher_providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/switcher_providers')>();
  return {
    ...actual,
    getSavedSwitcherVisibility: () => ({ ...harness.initial_visibility }),
    saveSwitcherVisibility: harness.save_visibility,
  };
});

vi.mock('../src/services/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/storage')>();
  return {
    ...actual,
    readStorageValue: <T,>(): StorageReadResult<T> => ({ status: 'missing' }),
    writeStorageItem: vi.fn(() => true),
    subscribeStorageReadFailures: () => () => {},
    subscribeStorageWriteFailures: (listener: () => void) => {
      harness.write_failure_listener = listener;
      return () => {
        if (harness.write_failure_listener === listener) {
          harness.write_failure_listener = null;
        }
      };
    },
  };
});

import App from '../src/App';

function visibility(
  target: TrayServiceName,
  target_value: boolean,
  peer?: TrayServiceName,
): SwitcherVisibility {
  return {
    antigravity: target === 'antigravity' ? target_value : peer === 'antigravity',
    claude: target === 'claude' ? target_value : peer === 'claude',
    codex: target === 'codex' ? target_value : peer === 'codex',
    cursor: target === 'cursor' ? target_value : peer === 'cursor',
  };
}

function peer_for(service: TrayServiceName): TrayServiceName {
  return SERVICES.find((candidate) => candidate !== service)!;
}

function rendered_text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

function settings(renderer: ReactTestRenderer) {
  return renderer.root.findByType(SettingsView);
}

async function render_app(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(StrictMode, null, createElement(App)));
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount());
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  harness.initial_visibility = visibility('claude', true);
  harness.saved_tab = 'all';
  harness.settings_expanded = true;
  harness.save_visibility.mockReset();
  harness.save_visibility.mockReturnValue(true);
  harness.write_failure_listener = null;

  vi.spyOn(backend, 'getQuota').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({ connected: true, availableCount: 0, credits: [] });
  vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getAntigravityInfo').mockResolvedValue({ connected: false, status: 'pending' });
  vi.spyOn(backend, 'getCostOverview').mockImplementation(async (source) => ({
    source,
    displayName: source,
    currency: 'USD',
    generatedAt: '2026-07-16T00:00:00Z',
    cached: false,
    ranges: [],
  }));
  vi.spyOn(backend, 'getCostDaily').mockImplementation(async (source) => ({
    source,
    currency: 'USD',
    generatedAt: '2026-07-16T00:00:00Z',
    cached: false,
    days: [],
  }));
  vi.spyOn(backend, 'setDockVisibility').mockResolvedValue(undefined);
  vi.spyOn(backend, 'updateTrayIcon').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

describe.each(SERVICES)('blocked %s visibility transition', (service) => {
  test('keeps the only visible provider and reports the guard without persistence', async () => {
    const initial = visibility(service, true);
    harness.initial_visibility = initial;
    const renderer = await render_app();

    await act(async () => settings(renderer).props.onSwitcherToggle(service));

    expect(settings(renderer).props.switcherVisibility).toEqual(initial);
    expect(harness.save_visibility).not.toHaveBeenCalled();
    expect(rendered_text(renderer).split(SWITCHER_GUARD_MESSAGE)).toHaveLength(2);
    await unmount(renderer);
  });
});

describe.each(SERVICES)('accepted %s visibility transition', (service) => {
  test('enables the target once and preserves every peer', async () => {
    const initial = visibility(service, false, peer_for(service));
    const expected = { ...initial, [service]: true };
    harness.initial_visibility = initial;
    const renderer = await render_app();

    await act(async () => settings(renderer).props.onSwitcherToggle(service));

    expect(settings(renderer).props.switcherVisibility).toEqual(expected);
    expect(saveSwitcherVisibility).toHaveBeenCalledTimes(1);
    expect(saveSwitcherVisibility).toHaveBeenCalledWith(expected);
    expect(rendered_text(renderer)).not.toContain(SWITCHER_GUARD_MESSAGE);
    await unmount(renderer);
  });

  test('disables the target once when a peer remains visible', async () => {
    const initial = visibility(service, true, peer_for(service));
    const expected = { ...initial, [service]: false };
    harness.initial_visibility = initial;
    const renderer = await render_app();

    await act(async () => settings(renderer).props.onSwitcherToggle(service));

    expect(settings(renderer).props.switcherVisibility).toEqual(expected);
    expect(saveSwitcherVisibility).toHaveBeenCalledTimes(1);
    expect(saveSwitcherVisibility).toHaveBeenCalledWith(expected);
    expect(rendered_text(renderer)).not.toContain(SWITCHER_GUARD_MESSAGE);
    await unmount(renderer);
  });
});

test('uses the latest committed callback for sequential accepted transitions', async () => {
  harness.initial_visibility = visibility('claude', true);
  const renderer = await render_app();

  await act(async () => settings(renderer).props.onSwitcherToggle('codex'));
  const after_enable = { ...harness.initial_visibility, codex: true };
  expect(settings(renderer).props.switcherVisibility).toEqual(after_enable);

  await act(async () => settings(renderer).props.onSwitcherToggle('claude'));
  const after_disable = { ...after_enable, claude: false };
  expect(settings(renderer).props.switcherVisibility).toEqual(after_disable);
  expect(harness.save_visibility.mock.calls).toEqual([[after_enable], [after_disable]]);
  await unmount(renderer);
});

test('gives the latest blocked event a full owned toast duration', async () => {
  const renderer = await render_app();
  const set_timeout = vi.spyOn(globalThis, 'setTimeout');
  const clear_timeout = vi.spyOn(globalThis, 'clearTimeout');
  set_timeout.mockClear();
  clear_timeout.mockClear();

  await act(async () => settings(renderer).props.onSwitcherToggle('claude'));
  expect(set_timeout).toHaveBeenCalledTimes(1);
  expect(set_timeout.mock.calls[0][1]).toBe(TRAY_GUARD_TOAST_MS);
  const first_timer = set_timeout.mock.results[0].value;

  await act(async () => vi.advanceTimersByTime(TRAY_GUARD_TOAST_MS / 2));
  await act(async () => settings(renderer).props.onSwitcherToggle('claude'));
  expect(clear_timeout).toHaveBeenCalledWith(first_timer);
  expect(set_timeout).toHaveBeenCalledTimes(2);
  expect(set_timeout.mock.calls[1][1]).toBe(TRAY_GUARD_TOAST_MS);

  await act(async () => vi.advanceTimersByTime(TRAY_GUARD_TOAST_MS / 2));
  expect(rendered_text(renderer)).toContain(SWITCHER_GUARD_MESSAGE);
  await act(async () => vi.advanceTimersByTime(TRAY_GUARD_TOAST_MS / 2 - 1));
  expect(rendered_text(renderer)).toContain(SWITCHER_GUARD_MESSAGE);
  await act(async () => vi.advanceTimersByTime(1));
  expect(rendered_text(renderer)).not.toContain(SWITCHER_GUARD_MESSAGE);
  expect(harness.save_visibility).not.toHaveBeenCalled();
  await unmount(renderer);
});

test('does not let the owned guard timer clear a newer storage toast', async () => {
  const renderer = await render_app();
  await act(async () => settings(renderer).props.onSwitcherToggle('claude'));
  await act(async () => vi.advanceTimersByTime(TRAY_GUARD_TOAST_MS / 4));

  expect(harness.write_failure_listener).not.toBeNull();
  await act(async () => harness.write_failure_listener!());
  expect(rendered_text(renderer)).toContain(STORAGE_WRITE_FAILURE_MESSAGE);

  await act(async () => vi.advanceTimersByTime(TRAY_GUARD_TOAST_MS * 3 / 4));
  expect(rendered_text(renderer)).toContain(STORAGE_WRITE_FAILURE_MESSAGE);
  await act(async () => vi.advanceTimersByTime(TRAY_GUARD_TOAST_MS / 4));
  expect(rendered_text(renderer)).not.toContain(STORAGE_WRITE_FAILURE_MESSAGE);
  await unmount(renderer);
});

test('cancels the owned guard timer on unmount', async () => {
  const renderer = await render_app();
  const set_timeout = vi.spyOn(globalThis, 'setTimeout');
  const clear_timeout = vi.spyOn(globalThis, 'clearTimeout');
  set_timeout.mockClear();
  clear_timeout.mockClear();

  await act(async () => settings(renderer).props.onSwitcherToggle('claude'));
  const guard_timer = set_timeout.mock.results[0].value;
  await unmount(renderer);

  expect(clear_timeout).toHaveBeenCalledWith(guard_timer);
  expect(() => vi.advanceTimersByTime(TRAY_GUARD_TOAST_MS)).not.toThrow();
});

test('keeps the existing Overview fallback when the active provider is hidden', async () => {
  harness.initial_visibility = visibility('codex', true, 'claude');
  harness.saved_tab = 'codex';
  const renderer = await render_app();

  await act(async () => settings(renderer).props.onSwitcherToggle('codex'));
  await act(async () => {
    settings(renderer).props.onClose();
    await Promise.resolve();
  });

  expect(renderer.root.findByType(TabSwitcher).props.activeTab).toBe('all');
  expect(harness.save_visibility).toHaveBeenCalledTimes(1);
  await unmount(renderer);
});

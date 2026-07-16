import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeStorageReadFailureToast } from '../src/App';
import {
  getSavedDockHidden,
  getSavedSettingsExpanded,
  getSavedTab,
  getSavedTheme,
} from '../src/services/app_state';
import { getSavedMonthlyBudgets } from '../src/services/budget';
import { getSavedEvents, type AppEvent } from '../src/services/event_log';
import {
  defaultNotificationSettings,
  getSavedNotificationSettings,
  shouldNotify,
} from '../src/services/notifications';
import { defaultPanelSections, getSavedPanelSections } from '../src/services/panel_sections';
import {
  STORAGE_READ_FAILURE_MESSAGE,
  readStorageValue,
  subscribeStorageReadFailures,
  writeStorageItem,
} from '../src/services/storage';
import {
  defaultSwitcherVisibility,
  getSavedSwitcherVisibility,
} from '../src/services/switcher_providers';
import { getSavedTrayCycle, getSavedTrayStyle } from '../src/services/tray_style';
import { getSavedTrayEnabled } from '../src/services/tray_visibility';

function installMemoryStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    },
  });
  return values;
}

function installReadFailure(error: Error): ReturnType<typeof vi.fn> {
  const setItem = vi.fn();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        throw error;
      },
      setItem,
    },
  });
  return setItem;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).localStorage;
});

interface UserVisibleReadCase {
  name: string;
  key: string;
  validRaw: string;
  malformedRaw: string;
  read: () => unknown;
  expectedValue: unknown;
  expectedDefault: unknown;
}

const savedEvent: AppEvent = {
  id: 'event-1',
  time: '2026-07-16T00:00:00.000Z',
  level: 'warning',
  text: 'Quota warning',
};

const userVisibleReadCases: UserVisibleReadCase[] = [
  {
    name: 'active tab',
    key: 'claude-quota-tab',
    validRaw: 'codex',
    malformedRaw: 'unknown',
    read: getSavedTab,
    expectedValue: 'codex',
    expectedDefault: 'claude',
  },
  {
    name: 'theme',
    key: 'claude-quota-theme',
    validRaw: 'ocean',
    malformedRaw: 'neon',
    read: getSavedTheme,
    expectedValue: 'ocean',
    expectedDefault: 'light',
  },
  {
    name: 'dock visibility',
    key: 'claude-quota-dock-hidden',
    validRaw: 'true',
    malformedRaw: 'yes',
    read: getSavedDockHidden,
    expectedValue: true,
    expectedDefault: false,
  },
  {
    name: 'settings expansion',
    key: 'claude-quota-settings-expanded',
    validRaw: 'true',
    malformedRaw: '1',
    read: getSavedSettingsExpanded,
    expectedValue: true,
    expectedDefault: false,
  },
  {
    name: 'monthly budgets',
    key: 'claude-quota-monthly-budgets',
    validRaw: JSON.stringify({ claude: 50 }),
    malformedRaw: JSON.stringify({ claude: '50' }),
    read: getSavedMonthlyBudgets,
    expectedValue: { claude: 50 },
    expectedDefault: {},
  },
  {
    name: 'notification settings',
    key: 'claude-quota-notifications',
    validRaw: JSON.stringify({ q80: false }),
    malformedRaw: JSON.stringify({ q80: 'false' }),
    read: getSavedNotificationSettings,
    expectedValue: { ...defaultNotificationSettings(), q80: false },
    expectedDefault: defaultNotificationSettings(),
  },
  {
    name: 'panel sections',
    key: 'claude-quota-panel-sections',
    validRaw: JSON.stringify({ timeline: false }),
    malformedRaw: JSON.stringify({ timeline: 0 }),
    read: getSavedPanelSections,
    expectedValue: { ...defaultPanelSections(), timeline: false },
    expectedDefault: defaultPanelSections(),
  },
  {
    name: 'switcher visibility',
    key: 'claude-quota-switcher-providers',
    validRaw: JSON.stringify({ cursor: false }),
    malformedRaw: JSON.stringify({ cursor: 0 }),
    read: getSavedSwitcherVisibility,
    expectedValue: { ...defaultSwitcherVisibility(), cursor: false },
    expectedDefault: defaultSwitcherVisibility(),
  },
  {
    name: 'tray style',
    key: 'claude-quota-tray-style',
    validRaw: 'ring',
    malformedRaw: 'square',
    read: getSavedTrayStyle,
    expectedValue: 'ring',
    expectedDefault: 'percent',
  },
  {
    name: 'tray cycle',
    key: 'claude-quota-tray-cycle',
    validRaw: 'true',
    malformedRaw: 'enabled',
    read: getSavedTrayCycle,
    expectedValue: true,
    expectedDefault: false,
  },
  {
    name: 'tray visibility',
    key: 'antigravity-tray-enabled',
    validRaw: 'true',
    malformedRaw: 'enabled',
    read: () => getSavedTrayEnabled('antigravity'),
    expectedValue: true,
    expectedDefault: false,
  },
  {
    name: 'event history',
    key: 'claude-quota-events',
    validRaw: JSON.stringify([savedEvent]),
    malformedRaw: JSON.stringify([savedEvent, { ...savedEvent, level: 'unknown' }]),
    read: getSavedEvents,
    expectedValue: [savedEvent],
    expectedDefault: [],
  },
];

describe('user-visible storage readers', () => {
  it.each(userVisibleReadCases)('reads valid $name data without reporting failure', (testCase) => {
    installMemoryStorage({ [testCase.key]: testCase.validRaw });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);

    expect(testCase.read()).toEqual(testCase.expectedValue);
    expect(consoleError).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(userVisibleReadCases)('uses the current $name default when missing', (testCase) => {
    installMemoryStorage();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);

    expect(testCase.read()).toEqual(testCase.expectedDefault);
    expect(consoleError).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(userVisibleReadCases)('reports $name access failure once and uses the default', (testCase) => {
    const setItem = installReadFailure(new Error(`${testCase.key}=sentinel-value`));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);

    expect(testCase.read()).toEqual(testCase.expectedDefault);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to access local storage.');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(testCase.key);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sentinel-value');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(userVisibleReadCases)('rejects malformed $name data as one visible failure', (testCase) => {
    installMemoryStorage({ [testCase.key]: testCase.malformedRaw });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);

    expect(testCase.read()).toEqual(testCase.expectedDefault);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to decode local storage value.');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(testCase.malformedRaw);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('treats all-hidden switcher state as a visible schema failure', () => {
    installMemoryStorage({
      'claude-quota-switcher-providers': JSON.stringify({
        claude: false,
        codex: false,
        cursor: false,
        antigravity: false,
      }),
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);

    expect(getSavedSwitcherVisibility()).toEqual(defaultSwitcherVisibility());
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to decode local storage value.');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('rejects a non-object notification settings root', () => {
    installMemoryStorage({ 'claude-quota-notifications': '[]' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);

    expect(getSavedNotificationSettings()).toEqual(defaultNotificationSettings());
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to decode local storage value.');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('notification dedupe storage reader', () => {
  it('preserves valid and missing behavior without a settings read warning', () => {
    installMemoryStorage({ 'claude-quota-notified': JSON.stringify({ warning: 900 }) });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);

    expect(shouldNotify('warning', 1_000)).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    installMemoryStorage();
    expect(shouldNotify('warning', 1_000)).toBe(true);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('fails closed with zero write on access failure and retries after recovery', () => {
    const setItem = installReadFailure(new Error('dedupe-key=dedupe-value'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);

    expect(shouldNotify('warning', 1_000)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to access local storage.');

    installMemoryStorage();
    expect(shouldNotify('warning', 1_000)).toBe(true);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(['{bad-json', '[]', JSON.stringify({ warning: 'recent' })])(
    'fails closed with zero write on malformed dedupe data: %s',
    (malformedRaw) => {
      installMemoryStorage({ 'claude-quota-notified': malformedRaw });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const listener = vi.fn();
      const unsubscribe = subscribeStorageReadFailures(listener);

      expect(shouldNotify('warning', 1_000)).toBe(false);
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to decode local storage value.');
      unsubscribe();
    },
  );
});

describe('App storage read failure wiring', () => {
  it('delivers one pending message, clears it, and honors unsubscribe', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installReadFailure(new Error('startup unavailable'));
    getSavedTab();
    getSavedTheme();

    const setToast = vi.fn();
    const scheduled: Array<() => void> = [];
    const schedule = vi.fn((callback: () => void) => {
      scheduled.push(callback);
    });
    const unsubscribe = subscribeStorageReadFailureToast(setToast, schedule);

    expect(setToast).toHaveBeenCalledExactlyOnceWith(STORAGE_READ_FAILURE_MESSAGE);
    expect(schedule).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 2_000);
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(setToast).toHaveBeenNthCalledWith(2, null);

    unsubscribe();
    getSavedTab();
    expect(setToast).toHaveBeenCalledTimes(2);

    const consumePending = vi.fn();
    const unsubscribePending = subscribeStorageReadFailures(consumePending);
    expect(consumePending).toHaveBeenCalledTimes(1);
    unsubscribePending();
  });
});

describe('typed storage read adapter', () => {
  it('distinguishes decoded values from missing values', () => {
    installMemoryStorage({ present: '42' });

    expect(readStorageValue('present', Number, { notifyUser: false })).toEqual({
      status: 'value',
      value: 42,
    });
    expect(readStorageValue('missing', Number, { notifyUser: false })).toEqual({
      status: 'missing',
    });
  });

  it('reads and decodes the failed-write session shadow first', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => 'persisted',
        setItem: () => {
          throw new Error('write unavailable');
        },
      },
    });

    expect(writeStorageItem('shadow-read', 'session', {
      preserveSessionValue: true,
      notifyUser: false,
    })).toBe(false);
    expect(readStorageValue('shadow-read', (raw) => raw.toUpperCase(), {
      notifyUser: false,
    })).toEqual({ status: 'value', value: 'SESSION' });
    expect(consoleError).toHaveBeenCalledTimes(1);

    installMemoryStorage();
    expect(writeStorageItem('shadow-read', 'cleanup')).toBe(true);
  });

  it('uses fixed access and decode logs without exposing exception or raw sentinels', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installReadFailure(new Error('secret-key=secret-value'));

    expect(readStorageValue('secret-key', (raw) => raw, { notifyUser: false })).toEqual({
      status: 'failure',
    });
    expect(consoleError).toHaveBeenNthCalledWith(1, 'Failed to access local storage.');

    installMemoryStorage({ 'secret-key': 'raw-secret-value' });
    expect(readStorageValue('secret-key', () => {
      throw new Error('raw-secret-value');
    }, { notifyUser: false })).toEqual({ status: 'failure' });
    expect(consoleError).toHaveBeenNthCalledWith(2, 'Failed to decode local storage value.');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret-key');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret-value');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('raw-secret-value');
  });

  it('coalesces pending failures and stops after unsubscribe', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installReadFailure(new Error('unavailable'));

    readStorageValue('one', (raw) => raw, { notifyUser: true });
    readStorageValue('two', (raw) => raw, { notifyUser: true });
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    readStorageValue('three', (raw) => raw, { notifyUser: true });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    readStorageValue('four', (raw) => raw, { notifyUser: true });
    expect(listener).toHaveBeenCalledTimes(2);

    const consumePending = vi.fn();
    const unsubscribePending = subscribeStorageReadFailures(consumePending);
    expect(consumePending).toHaveBeenCalledTimes(1);
    unsubscribePending();
  });

  it('logs a listener failure and continues notifying other listeners', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installReadFailure(new Error('unavailable'));
    const unsubscribeThrowing = subscribeStorageReadFailures(() => {
      throw new Error('listener secret');
    });
    const listener = vi.fn();
    const unsubscribeListener = subscribeStorageReadFailures(listener);

    expect(readStorageValue('setting', (raw) => raw, { notifyUser: true })).toEqual({
      status: 'failure',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenNthCalledWith(1, 'Failed to access local storage.');
    expect(consoleError).toHaveBeenNthCalledWith(
      2,
      'Failed to report local storage read failure.',
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('listener secret');

    unsubscribeThrowing();
    unsubscribeListener();
  });
});

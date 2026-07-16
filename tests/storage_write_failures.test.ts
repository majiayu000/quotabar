import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import {
  getSavedDockHidden,
  getSavedSettingsExpanded,
  getSavedTab,
  getSavedTheme,
  saveActiveTab,
  saveDockHidden,
  saveSettingsExpanded,
  saveTheme,
} from '../src/services/app_state';
import { getSavedMonthlyBudgets, saveMonthlyBudgets } from '../src/services/budget';
import { getSavedEvents, recordEvent } from '../src/services/event_log';
import {
  getSavedNotificationSettings,
  saveNotificationSettings,
  shouldNotify,
} from '../src/services/notifications';
import { getSavedPanelSections, savePanelSections } from '../src/services/panel_sections';
import {
  readStorageItem,
  subscribeStorageWriteFailures,
  writeStorageItem,
} from '../src/services/storage';
import {
  getSavedSwitcherVisibility,
  saveSwitcherVisibility,
} from '../src/services/switcher_providers';
import {
  getSavedTrayCycle,
  getSavedTrayStyle,
  saveTrayCycle,
  saveTrayStyle,
} from '../src/services/tray_style';
import { getSavedTrayEnabled, saveTrayEnabled } from '../src/services/tray_visibility';

function installMemoryStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
  return values;
}

function installThrowingStorage(error: Error): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw error;
      },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('storage write adapter', () => {
  it('writes successfully and reads the persisted value', () => {
    const values = installMemoryStorage();

    expect(writeStorageItem('success-key', 'saved')).toBe(true);
    expect(values.get('success-key')).toBe('saved');
    expect(readStorageItem('success-key')).toBe('saved');
  });

  it('preserves a failed value for the session and reports the original error', () => {
    const error = new Error('storage unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installThrowingStorage(error);

    expect(writeStorageItem('shadow-key', 'session-value', {
      preserveSessionValue: true,
      notifyUser: false,
    })).toBe(false);
    expect(readStorageItem('shadow-key')).toBe('session-value');
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      'Failed to persist local setting:',
      error,
    );
  });

  it('clears a stale shadow after storage recovers', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installThrowingStorage(new Error('quota exceeded'));
    expect(writeStorageItem('recovery-key', 'stale', {
      preserveSessionValue: true,
      notifyUser: false,
    })).toBe(false);

    installMemoryStorage();
    expect(writeStorageItem('recovery-key', 'persisted')).toBe(true);
    expect(readStorageItem('recovery-key')).toBe('persisted');
  });

  it('notifies subscribers once and stops after unsubscribe', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installThrowingStorage(new Error('denied'));
    const listener = vi.fn();
    const unsubscribe = subscribeStorageWriteFailures(listener);

    expect(writeStorageItem('notify-key', 'first', {
      preserveSessionValue: false,
      notifyUser: true,
    })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(writeStorageItem('notify-key', 'second', {
      preserveSessionValue: false,
      notifyUser: true,
    })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readStorageItem('notify-key')).toBeNull();
  });

  it('logs a subscriber error and continues reporting the storage failure', () => {
    const storageError = new Error('denied');
    const listenerError = new Error('listener failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installThrowingStorage(storageError);
    const unsubscribe = subscribeStorageWriteFailures(() => {
      throw listenerError;
    });

    expect(writeStorageItem('listener-error-key', 'value', {
      preserveSessionValue: false,
      notifyUser: true,
    })).toBe(false);
    expect(consoleError).toHaveBeenNthCalledWith(
      1,
      'Failed to report local storage write failure:',
      listenerError,
    );
    expect(consoleError).toHaveBeenNthCalledWith(
      2,
      'Failed to persist local setting:',
      storageError,
    );

    unsubscribe();
  });
});

interface UserSettingCase {
  name: string;
  key: string;
  serialized: string;
  save: () => boolean;
  read: () => unknown;
  expectedRead: unknown;
}

const notificationSettings = { q80: false, q95: true, bonus: false };
const panelSections = { timeline: false, cost: true, trend: false, tips: true };
const switcherVisibility = {
  claude: true,
  codex: false,
  cursor: true,
  antigravity: false,
};

const userSettingCases: UserSettingCase[] = [
  {
    name: 'monthly budgets',
    key: 'claude-quota-monthly-budgets',
    serialized: JSON.stringify({ claude: 50 }),
    save: () => saveMonthlyBudgets({ claude: 50 }),
    read: getSavedMonthlyBudgets,
    expectedRead: { claude: 50 },
  },
  {
    name: 'notification settings',
    key: 'claude-quota-notifications',
    serialized: JSON.stringify(notificationSettings),
    save: () => saveNotificationSettings(notificationSettings),
    read: getSavedNotificationSettings,
    expectedRead: notificationSettings,
  },
  {
    name: 'panel sections',
    key: 'claude-quota-panel-sections',
    serialized: JSON.stringify(panelSections),
    save: () => savePanelSections(panelSections),
    read: getSavedPanelSections,
    expectedRead: panelSections,
  },
  {
    name: 'switcher visibility',
    key: 'claude-quota-switcher-providers',
    serialized: JSON.stringify(switcherVisibility),
    save: () => saveSwitcherVisibility(switcherVisibility),
    read: getSavedSwitcherVisibility,
    expectedRead: switcherVisibility,
  },
  {
    name: 'tray style',
    key: 'claude-quota-tray-style',
    serialized: 'ring',
    save: () => saveTrayStyle('ring'),
    read: getSavedTrayStyle,
    expectedRead: 'ring',
  },
  {
    name: 'tray cycle',
    key: 'claude-quota-tray-cycle',
    serialized: 'true',
    save: () => saveTrayCycle(true),
    read: getSavedTrayCycle,
    expectedRead: true,
  },
  {
    name: 'tray visibility',
    key: 'antigravity-tray-enabled',
    serialized: 'true',
    save: () => saveTrayEnabled('antigravity', true),
    read: () => getSavedTrayEnabled('antigravity'),
    expectedRead: true,
  },
  {
    name: 'active tab',
    key: 'claude-quota-tab',
    serialized: 'codex',
    save: () => saveActiveTab('codex'),
    read: getSavedTab,
    expectedRead: 'codex',
  },
  {
    name: 'theme',
    key: 'claude-quota-theme',
    serialized: 'ocean',
    save: () => saveTheme('ocean'),
    read: getSavedTheme,
    expectedRead: 'ocean',
  },
  {
    name: 'dock visibility',
    key: 'claude-quota-dock-hidden',
    serialized: 'true',
    save: () => saveDockHidden(true),
    read: getSavedDockHidden,
    expectedRead: true,
  },
  {
    name: 'settings expanded',
    key: 'claude-quota-settings-expanded',
    serialized: 'true',
    save: () => saveSettingsExpanded(true),
    read: getSavedSettingsExpanded,
    expectedRead: true,
  },
];

describe('user setting savers', () => {
  it.each(userSettingCases)('round-trips $name with the existing key and format', (testCase) => {
    const values = installMemoryStorage();

    expect(testCase.save()).toBe(true);
    expect(values.get(testCase.key)).toBe(testCase.serialized);
    expect(testCase.read()).toEqual(testCase.expectedRead);
  });

  it.each(userSettingCases)(
    'returns false, preserves $name, and notifies exactly once on failure',
    (testCase) => {
      installMemoryStorage();
      expect(writeStorageItem(testCase.key, 'baseline')).toBe(true);
      installThrowingStorage(new Error(`${testCase.name} unavailable`));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const listener = vi.fn();
      const unsubscribe = subscribeStorageWriteFailures(listener);

      expect(testCase.save()).toBe(false);
      expect(readStorageItem(testCase.key)).toBe(testCase.serialized);
      expect(testCase.read()).toEqual(testCase.expectedRead);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      installMemoryStorage();
      expect(writeStorageItem(testCase.key, 'cleanup')).toBe(true);
    },
  );
});

describe('background storage writes', () => {
  it('fails notification dedupe closed without shadow or user notification, then retries', () => {
    const key = 'claude-quota-notified';
    installMemoryStorage();
    expect(writeStorageItem(key, '{}')).toBe(true);
    installThrowingStorage(new Error('dedupe unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageWriteFailures(listener);

    expect(shouldNotify('quota warning', 1_000)).toBe(false);
    expect(readStorageItem(key)).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    const values = installMemoryStorage();
    expect(shouldNotify('quota warning', 1_000)).toBe(true);
    expect(JSON.parse(values.get(key) ?? '')).toEqual({ 'quota warning': 1_000 });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps a failed event write in the session without notifying the user', () => {
    const key = 'claude-quota-events';
    const error = new Error('event storage unavailable');
    installMemoryStorage();
    expect(writeStorageItem(key, '[]')).toBe(true);
    installThrowingStorage(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeStorageWriteFailures(listener);

    const events = recordEvent([], 'warning', 'Quota warning', 1_700_000_000_000);

    expect(events).toHaveLength(1);
    expect(getSavedEvents()).toEqual(events);
    expect(listener).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      'Failed to persist local setting:',
      error,
    );

    unsubscribe();
    installMemoryStorage();
    expect(writeStorageItem(key, '[]')).toBe(true);
  });
});

describe('App storage wiring', () => {
  it('renders with the migrated storage-backed settings', () => {
    installMemoryStorage();

    const html = renderToString(createElement(App));

    expect(html).toContain('class="app theme-light"');
  });
});

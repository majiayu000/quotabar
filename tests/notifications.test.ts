import { afterEach, describe, expect, test } from 'vitest';
import {
  defaultNotificationSettings,
  getSavedNotificationSettings,
  saveNotificationSettings,
  shouldNotify,
} from '../src/services/notifications';

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  return store;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

const NOW = Date.parse('2026-07-05T12:00:00Z');

describe('notification settings', () => {
  test('defaults to all enabled', () => {
    expect(getSavedNotificationSettings()).toEqual(defaultNotificationSettings());
  });

  test('round-trips toggles', () => {
    installMemoryStorage();
    saveNotificationSettings({ q80: false, q95: true, bonus: false });
    expect(getSavedNotificationSettings()).toEqual({ q80: false, q95: true, bonus: false });
  });

  test('dedupes repeated notification bodies within 12 hours', () => {
    installMemoryStorage();
    expect(shouldNotify('Claude usage crossed 80%', NOW)).toBe(true);
    expect(shouldNotify('Claude usage crossed 80%', NOW + 60 * 60000)).toBe(false);
    expect(shouldNotify('Claude usage crossed 80%', NOW + 13 * 3600000)).toBe(true);
    expect(shouldNotify('Codex usage crossed 80%', NOW)).toBe(true);
  });
});

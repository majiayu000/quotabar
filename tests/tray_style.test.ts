import { afterEach, describe, expect, test } from 'vitest';
import {
  getSavedTrayCycle,
  getSavedTrayStyle,
  saveTrayCycle,
  saveTrayStyle,
} from '../src/services/tray_style';

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

describe('tray style persistence', () => {
  test('defaults to percent style and cycle off', () => {
    expect(getSavedTrayStyle()).toBe('percent');
    expect(getSavedTrayCycle()).toBe(false);
  });

  test('round-trips style and cycle', () => {
    installMemoryStorage();
    saveTrayStyle('ring');
    saveTrayCycle(true);
    expect(getSavedTrayStyle()).toBe('ring');
    expect(getSavedTrayCycle()).toBe(true);
  });

  test('rejects unknown style values', () => {
    const store = installMemoryStorage();
    store.set('claude-quota-tray-style', 'rainbow');
    expect(getSavedTrayStyle()).toBe('percent');
  });
});

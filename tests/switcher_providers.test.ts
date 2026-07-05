import { afterEach, describe, expect, test } from 'vitest';
import {
  defaultSwitcherVisibility,
  getSavedSwitcherVisibility,
  saveSwitcherVisibility,
} from '../src/services/switcher_providers';

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

describe('switcher provider visibility', () => {
  test('defaults to all visible', () => {
    expect(getSavedSwitcherVisibility()).toEqual(defaultSwitcherVisibility());
  });

  test('round-trips saved visibility', () => {
    installMemoryStorage();
    const visibility = { ...defaultSwitcherVisibility(), cursor: false, antigravity: false };
    saveSwitcherVisibility(visibility);
    expect(getSavedSwitcherVisibility()).toEqual(visibility);
  });

  test('resets to defaults when every provider is hidden', () => {
    const store = installMemoryStorage();
    store.set(
      'claude-quota-switcher-providers',
      JSON.stringify({ claude: false, codex: false, cursor: false, antigravity: false }),
    );
    expect(getSavedSwitcherVisibility()).toEqual(defaultSwitcherVisibility());
  });
});

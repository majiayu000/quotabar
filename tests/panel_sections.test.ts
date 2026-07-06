import { afterEach, describe, expect, test } from 'vitest';
import {
  defaultPanelSections,
  getSavedPanelSections,
  savePanelSections,
} from '../src/services/panel_sections';

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

describe('panel sections persistence', () => {
  test('defaults to all sections visible without storage', () => {
    expect(getSavedPanelSections()).toEqual(defaultPanelSections());
  });

  test('round-trips saved visibility', () => {
    installMemoryStorage();
    const sections = { ...defaultPanelSections(), tips: false };
    savePanelSections(sections);
    expect(getSavedPanelSections()).toEqual(sections);
  });

  test('ignores corrupted or partial payloads', () => {
    const store = installMemoryStorage();
    store.set('claude-quota-panel-sections', 'not json');
    expect(getSavedPanelSections()).toEqual(defaultPanelSections());

    store.set('claude-quota-panel-sections', JSON.stringify({ cost: false, bogus: 1 }));
    expect(getSavedPanelSections()).toEqual({ ...defaultPanelSections(), cost: false });
  });
});

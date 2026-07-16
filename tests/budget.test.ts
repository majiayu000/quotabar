import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getBudgetForSources,
  getSavedMonthlyBudgets,
  saveMonthlyBudgets,
} from '../src/services/budget';

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
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('monthly budgets', () => {
  test('defaults to empty without storage', () => {
    expect(getSavedMonthlyBudgets()).toEqual({});
  });

  test('round-trips and rejects the whole record when a known value is invalid', () => {
    const store = installMemoryStorage();
    saveMonthlyBudgets({ claude: 400, codex: 150 });
    expect(getSavedMonthlyBudgets()).toEqual({ claude: 400, codex: 150 });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store.set('claude-quota-monthly-budgets', JSON.stringify({ claude: -5, codex: 'x', cursor: 50 }));
    expect(getSavedMonthlyBudgets()).toEqual({});
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to decode local storage value.');
  });

  test('sums budgets across sources and returns null when unset', () => {
    const budgets = { claude: 400, cursor: 50 };
    expect(getBudgetForSources(budgets, ['claude'])).toBe(400);
    expect(getBudgetForSources(budgets, ['claude', 'codex', 'cursor'])).toBe(450);
    expect(getBudgetForSources(budgets, ['codex'])).toBeNull();
    expect(getBudgetForSources({}, ['claude'])).toBeNull();
  });
});

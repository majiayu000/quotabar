import type { CostSource } from '../types/models';
import { readStorageValue, writeStorageItem } from './storage';

export type MonthlyBudgets = Partial<Record<CostSource, number>>;

export const BUDGET_SOURCES: CostSource[] = ['claude', 'codex', 'cursor'];

const STORAGE_KEY = 'claude-quota-monthly-budgets';

export function getSavedMonthlyBudgets(): MonthlyBudgets {
  const result = readStorageValue(STORAGE_KEY, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid saved budgets');
    }
    const budgets: MonthlyBudgets = {};
    for (const key of BUDGET_SOURCES) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid saved budget value');
      }
      budgets[key] = value;
    }
    return budgets;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : {};
}

export function saveMonthlyBudgets(budgets: MonthlyBudgets): boolean {
  return writeStorageItem(STORAGE_KEY, JSON.stringify(budgets), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

/**
 * Combined budget for the sources shown in a cost section.
 * Returns null when none of the sources has a budget configured.
 */
export function getBudgetForSources(
  budgets: MonthlyBudgets,
  sources: readonly CostSource[],
): number | null {
  let total = 0;
  let hasValue = false;
  for (const source of sources) {
    const value = budgets[source];
    if (value != null) {
      total += value;
      hasValue = true;
    }
  }
  return hasValue ? total : null;
}

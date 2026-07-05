import type { CostSource } from '../types/models';

export type MonthlyBudgets = Partial<Record<CostSource, number>>;

export const BUDGET_SOURCES: CostSource[] = ['claude', 'codex', 'cursor'];

const STORAGE_KEY = 'claude-quota-monthly-budgets';

export function getSavedMonthlyBudgets(): MonthlyBudgets {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const budgets: MonthlyBudgets = {};
    for (const key of BUDGET_SOURCES) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        budgets[key] = value;
      }
    }
    return budgets;
  } catch {
    return {};
  }
}

export function saveMonthlyBudgets(budgets: MonthlyBudgets): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(budgets));
  } catch {}
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

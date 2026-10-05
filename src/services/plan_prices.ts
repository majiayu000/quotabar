import { readStorageValue, writeStorageItem } from './storage';

/** Providers whose local API-equivalent usage can be compared with a plan price. */
export const PLAN_PRICE_PROVIDERS = ['claude', 'codex', 'cursor', 'grok'] as const;
export type PlanPriceProvider = typeof PLAN_PRICE_PROVIDERS[number];

/** Monthly plan prices in USD. Empty by default: QuotaBar never assumes a plan. */
export type PlanPrices = Partial<Record<PlanPriceProvider, number>>;

export const PLAN_PRICES_STORAGE_KEY = 'quotabar.plan-prices';

export function getSavedPlanPrices(): PlanPrices {
  const result = readStorageValue(PLAN_PRICES_STORAGE_KEY, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid saved plan prices');
    }
    const prices: PlanPrices = {};
    for (const key of PLAN_PRICE_PROVIDERS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid saved plan price');
      }
      prices[key] = value;
    }
    return prices;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : {};
}

export function savePlanPrices(prices: PlanPrices): boolean {
  return writeStorageItem(PLAN_PRICES_STORAGE_KEY, JSON.stringify(prices), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

/** Parse a settings input; blank, non-numeric or non-positive input clears the price. */
export function withPlanPrice(prices: PlanPrices, provider: PlanPriceProvider, raw: string): PlanPrices {
  const next = { ...prices };
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value <= 0) delete next[provider];
  else next[provider] = value;
  return next;
}

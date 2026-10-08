import { useCallback, useEffect, useState } from 'react';
import { getSavedPlanPrices, PLAN_PRICES_STORAGE_KEY, savePlanPrices, type PlanPrices } from '../services/plan_prices';

const planPriceListeners = new Set<(prices: PlanPrices) => void>();

/** Plan prices shared within a document and across windows through storage events. */
export function usePlanPrices(): [PlanPrices, (next: PlanPrices) => void] {
  const [prices, setPrices] = useState<PlanPrices>(getSavedPlanPrices);
  useEffect(() => {
    planPriceListeners.add(setPrices);
    const sync = (event: StorageEvent) => {
      if (event.key === PLAN_PRICES_STORAGE_KEY || event.key === null) setPrices(getSavedPlanPrices());
    };
    if (typeof window !== 'undefined') window.addEventListener('storage', sync);
    return () => {
      planPriceListeners.delete(setPrices);
      if (typeof window !== 'undefined') window.removeEventListener('storage', sync);
    };
  }, []);
  const update = useCallback((next: PlanPrices) => {
    setPrices(next);
    savePlanPrices(next);
    for (const listener of planPriceListeners) {
      if (listener !== setPrices) listener(next);
    }
  }, []);
  return [prices, update];
}

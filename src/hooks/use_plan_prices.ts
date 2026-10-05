import { useCallback, useEffect, useState } from 'react';
import { getSavedPlanPrices, PLAN_PRICES_STORAGE_KEY, savePlanPrices, type PlanPrices } from '../services/plan_prices';

/** Plan prices shared by the tray and workspace windows through storage events. */
export function usePlanPrices(): [PlanPrices, (next: PlanPrices) => void] {
  const [prices, setPrices] = useState<PlanPrices>(getSavedPlanPrices);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = (event: StorageEvent) => {
      if (event.key === PLAN_PRICES_STORAGE_KEY || event.key === null) setPrices(getSavedPlanPrices());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const update = useCallback((next: PlanPrices) => {
    setPrices(next);
    savePlanPrices(next);
  }, []);
  return [prices, update];
}

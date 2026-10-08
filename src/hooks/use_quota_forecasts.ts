import { useEffect, useRef, useState } from 'react';
import { SERVICES } from '../services/service_meta';
import type { ServiceMap } from '../services/app_state';
import type { ProviderReadState, QuotaWindowSummary } from '../services/provider_summary';
import {
  forecastQuotaWindows,
  recordQuotaRead,
  type QuotaForecastMap,
  type QuotaHistory,
} from '../services/quota_forecast';

/**
 * Keeps an in-memory history of successful quota reads and returns the
 * exhaustion forecasts. Failed reads add no samples and suppress forecasts
 * for that provider, so last-known data never produces an estimate.
 */
export function useQuotaForecasts(
  windows: readonly QuotaWindowSummary[],
  reads: ServiceMap<ProviderReadState>,
): QuotaForecastMap {
  const [history, setHistory] = useState<QuotaHistory>({});
  const recordedReadAt = useRef<Partial<ServiceMap<number>>>({});

  useEffect(() => {
    const updates: Array<{ windows: QuotaWindowSummary[]; readAt: number }> = [];
    for (const service of SERVICES) {
      const read = reads[service];
      if (read.error || read.readAt == null || recordedReadAt.current[service] === read.readAt) continue;
      recordedReadAt.current[service] = read.readAt;
      const providerWindows = windows.filter((window) => window.provider === service);
      if (providerWindows.length > 0) updates.push({ windows: providerWindows, readAt: read.readAt });
    }
    if (updates.length === 0) return;
    setHistory((previous) => updates.reduce(
      (next, update) => recordQuotaRead(next, update.windows, update.readAt),
      previous,
    ));
  }, [windows, reads]);

  const forecasts = forecastQuotaWindows(history);
  const fresh: Record<string, QuotaForecastMap[string]> = {};
  for (const [key, forecast] of Object.entries(forecasts)) {
    const provider = key.slice(0, key.indexOf(':')) as keyof ServiceMap<unknown>;
    if (!reads[provider]?.error) fresh[key] = forecast;
  }
  return fresh;
}

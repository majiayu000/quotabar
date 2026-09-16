import { useLocale } from '../i18n/react';
import { getLocale, t } from '../i18n';
import { useEffect, useState } from 'react';
import { formatEventTime } from '../services/event_log';

export function useFooterStatus(
  windowVisible: boolean,
  activeLoading: boolean,
  lastUpdatedAt: number | null,
  failed = false,
): { footerStatus: string; footerStatusTitle: string } {
  useLocale();
  const [, setStatusTick] = useState(0);

  useEffect(() => {
    if (!windowVisible) return;
    const interval = setInterval(() => setStatusTick((tick) => tick + 1), 30 * 1000);
    return () => clearInterval(interval);
  }, [windowVisible]);

  return {
    footerStatus: activeLoading
      ? t("Refreshing…")
      : lastUpdatedAt != null
        ? t("{p0}Last successful read {p1}", { p0: failed ? t("Stale data · ") : '', p1: formatEventTime(new Date(lastUpdatedAt).toISOString()) })
        : failed ? t("Quota unavailable · Retry") : t("No successful quota read yet"),
    footerStatusTitle: lastUpdatedAt != null
      ? t("Last successful read {p0}", { p0: new Date(lastUpdatedAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) })
      : t("No successful quota read yet"),
  };
}

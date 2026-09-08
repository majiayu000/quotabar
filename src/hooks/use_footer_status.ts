import { useEffect, useState } from 'react';
import { formatEventTime } from '../services/event_log';

export function useFooterStatus(
  windowVisible: boolean,
  activeLoading: boolean,
  lastUpdatedAt: number | null,
  failed = false,
): { footerStatus: string; footerStatusTitle: string } {
  const [, setStatusTick] = useState(0);

  useEffect(() => {
    if (!windowVisible) return;
    const interval = setInterval(() => setStatusTick((tick) => tick + 1), 30 * 1000);
    return () => clearInterval(interval);
  }, [windowVisible]);

  return {
    footerStatus: activeLoading
      ? 'Updating...'
      : lastUpdatedAt != null
        ? `${failed ? 'Stale · ' : ''}Last success ${formatEventTime(new Date(lastUpdatedAt).toISOString())}`
        : failed ? 'Quota unavailable · Retry' : 'No successful quota update yet',
    footerStatusTitle: lastUpdatedAt != null
      ? `Last successful quota update ${new Date(lastUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : 'No successful quota update yet',
  };
}

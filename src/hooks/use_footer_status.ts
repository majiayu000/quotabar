import { useEffect, useState } from 'react';
import { formatEventTime } from '../services/event_log';

export function useFooterStatus(
  windowVisible: boolean,
  activeLoading: boolean,
  lastUpdatedAt: number | null,
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
        ? `Updated ${formatEventTime(new Date(lastUpdatedAt).toISOString())}`
        : '',
    footerStatusTitle: lastUpdatedAt != null
      ? `Last updated ${new Date(lastUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : 'Not updated yet',
  };
}

import { useEffect, useRef } from 'react';
import { SERVICE_META, SERVICES } from '../services/service_meta';
import { getClaudeTrayUsedPercent, type ServiceMap } from '../services/app_state';
import { notify, type NotificationSettings } from '../services/notifications';
import type { EventLevel } from '../services/event_log';
import type { QuotaData } from '../types/models';

interface ServiceSnapshot {
  connected: boolean;
  used: number | null;
}

/**
 * Detects provider connectivity and usage-threshold transitions,
 * logging them to the event feed and (when enabled) sending
 * system notifications.
 */
export function useServiceEvents(
  quota: QuotaData | null,
  connected: ServiceMap<boolean>,
  usedPercent: ServiceMap<number | null>,
  notifSettings: NotificationSettings,
  logEvent: (level: EventLevel, text: string) => void,
): void {
  const prevServiceStateRef = useRef<ServiceMap<ServiceSnapshot> | null>(null);

  useEffect(() => {
    const current = SERVICES.reduce((acc, svc) => {
      acc[svc] = {
        connected: svc === 'claude' ? quota?.connected ?? false : connected[svc],
        used: svc === 'claude' ? getClaudeTrayUsedPercent(quota) : usedPercent[svc],
      };
      return acc;
    }, {} as ServiceMap<ServiceSnapshot>);

    const prev = prevServiceStateRef.current;
    prevServiceStateRef.current = current;
    if (!prev) return;

    for (const svc of SERVICES) {
      const label = SERVICE_META[svc].label;
      const before = prev[svc];
      const after = current[svc];

      if (before.connected !== after.connected) {
        logEvent(
          after.connected ? 'info' : 'warning',
          `${label} ${after.connected ? 'connected' : 'disconnected'}`,
        );
      }

      if (before.used != null && after.used != null) {
        if (before.used < 95 && after.used >= 95) {
          logEvent('critical', `${label} usage crossed 95%`);
          if (notifSettings.q95) {
            void notify('QuotaBar', `${label} usage crossed 95%`);
          }
        } else if (before.used < 80 && after.used >= 80) {
          logEvent('warning', `${label} usage crossed 80%`);
          if (notifSettings.q80) {
            void notify('QuotaBar', `${label} usage crossed 80%`);
          }
        }
      }
    }
  }, [quota, connected, usedPercent, logEvent, notifSettings.q80, notifSettings.q95]);
}

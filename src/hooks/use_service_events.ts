import { useEffect, useRef } from 'react';
import { SERVICE_META, SERVICES } from '../services/service_meta';
import { getClaudeTrayUsedPercent, type ServiceMap } from '../services/app_state';
import {
  createNotificationFailureOptions,
  notify,
  type NotificationSettings,
} from '../services/notifications';
import type { EventLevel } from '../services/event_log';
import type { QuotaData } from '../types/models';
import { STORAGE_READ_FAILURE_MESSAGE, subscribeStorageReadFailures } from '../services/storage';
import { TRAY_GUARD_TOAST_MS } from '../services/app_state';

export function subscribeStorageReadFailureToast(
  setToast: (value: string | null) => void,
  schedule: (callback: () => void, delayMs: number) => void = (callback, delayMs) => { setTimeout(callback, delayMs); },
): () => void {
  return subscribeStorageReadFailures(() => {
    setToast(STORAGE_READ_FAILURE_MESSAGE);
    schedule(() => setToast(null), TRAY_GUARD_TOAST_MS);
  });
}

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
  enabled = true,
): void {
  const prevServiceStateRef = useRef<ServiceMap<ServiceSnapshot> | null>(null);

  useEffect(() => {
    if (!enabled) return;
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
            void notify(
              'QuotaBar',
              `${label} usage crossed 95%`,
              createNotificationFailureOptions(logEvent),
            );
          }
        } else if (before.used < 80 && after.used >= 80) {
          logEvent('warning', `${label} usage crossed 80%`);
          if (notifSettings.q80) {
            void notify(
              'QuotaBar',
              `${label} usage crossed 80%`,
              createNotificationFailureOptions(logEvent),
            );
          }
        }
        if (before.used < 100 && after.used >= 100) {
          logEvent('critical', `${label} usage reached 100%`);
          if (notifSettings.q100) {
            void notify(
              'QuotaBar',
              `${label} usage reached 100%`,
              createNotificationFailureOptions(logEvent),
            );
          }
        }
      }
    }
  }, [quota, connected, usedPercent, logEvent, notifSettings.q80, notifSettings.q95, notifSettings.q100, enabled]);
}

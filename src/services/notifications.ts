import { hasTauriBackend } from './backend';
import { readStorageValue, writeStorageItem } from './storage';

export type NotificationKey = 'q80' | 'q95' | 'bonus';

export type NotificationSettings = Record<NotificationKey, boolean>;

export type NotificationDeliveryResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: 'backend_unavailable' | 'duplicate' | 'in_flight' }
  | { status: 'failure'; message: string };

export interface NotificationDeliveryOptions {
  on_failure?: (message: string) => void;
}

export const NOTIFICATION_DEDUPE_FAILURE_MESSAGE =
  'Notification delivery could not verify recent delivery history.';
export const NOTIFICATION_PERMISSION_DENIED_MESSAGE =
  'Notification permission was denied.';
export const NOTIFICATION_DELIVERY_FAILURE_MESSAGE =
  'System notification delivery failed.';
const NOTIFICATION_FAILURE_REPORTING_MESSAGE =
  'Failed to report notification delivery failure.';

export const NOTIFICATION_ROWS: Array<{ key: NotificationKey; label: string }> = [
  { key: 'q80', label: 'Alert at 80% used' },
  { key: 'q95', label: 'Critical alert at 95%' },
  { key: 'bonus', label: 'Bonus expiry reminders' },
];

const STORAGE_KEY = 'claude-quota-notifications';
/** One system notification per unique body within this window. */
const NOTIFY_DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;
const DEDUPE_STORAGE_KEY = 'claude-quota-notified';
const deliveredThisSession = new Map<string, number>();
const notificationsInFlight = new Set<string>();
type NotificationPlugin = typeof import('@tauri-apps/plugin-notification');
let notificationPluginPromise: Promise<NotificationPlugin> | undefined;

export function defaultNotificationSettings(): NotificationSettings {
  return { q80: true, q95: true, bonus: true };
}

export function getSavedNotificationSettings(): NotificationSettings {
  const defaults = defaultNotificationSettings();
  const result = readStorageValue(STORAGE_KEY, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid saved notification settings');
    }
    for (const { key } of NOTIFICATION_ROWS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') throw new Error('Invalid saved notification value');
      defaults[key] = value;
    }
    return defaults;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : defaultNotificationSettings();
}

export function saveNotificationSettings(settings: NotificationSettings): boolean {
  return writeStorageItem(STORAGE_KEY, JSON.stringify(settings), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

function loadNotified() {
  return readStorageValue(DEDUPE_STORAGE_KEY, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid notification dedupe record');
    }
    for (const value of Object.values(parsed)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Invalid notification dedupe timestamp');
      }
    }
    return parsed as Record<string, number>;
  }, { notifyUser: false });
}

type NotificationEligibility = 'eligible' | 'duplicate' | 'failure';

function pruneDeliveredThisSession(now: number): void {
  for (const [body, deliveredAt] of deliveredThisSession) {
    if (now - deliveredAt >= NOTIFY_DEDUPE_WINDOW_MS) {
      deliveredThisSession.delete(body);
    }
  }
}

function getNotificationEligibility(body: string, now: number): NotificationEligibility {
  pruneDeliveredThisSession(now);
  const deliveredThisSessionAt = deliveredThisSession.get(body);
  if (
    typeof deliveredThisSessionAt === 'number'
    && now - deliveredThisSessionAt < NOTIFY_DEDUPE_WINDOW_MS
  ) {
    return 'duplicate';
  }
  const result = loadNotified();
  if (result.status === 'failure') return 'failure';
  const notified = result.status === 'value' ? result.value : {};
  const last = notified[body];
  return typeof last === 'number' && now - last < NOTIFY_DEDUPE_WINDOW_MS
    ? 'duplicate'
    : 'eligible';
}

export function shouldNotify(body: string, now: number = Date.now()): boolean {
  return getNotificationEligibility(body, now) === 'eligible';
}

function commitNotificationDelivery(body: string, now: number): void {
  pruneDeliveredThisSession(now);
  deliveredThisSession.set(body, now);
  const result = loadNotified();
  if (result.status === 'failure') return;
  const notified = result.status === 'value' ? result.value : {};
  const next: Record<string, number> = { [body]: now };
  for (const [key, value] of Object.entries(notified)) {
    if (typeof value === 'number' && now - value < NOTIFY_DEDUPE_WINDOW_MS) {
      next[key] = value;
    }
  }
  writeStorageItem(DEDUPE_STORAGE_KEY, JSON.stringify(next), {
    preserveSessionValue: true,
    notifyUser: false,
    logErrorDetails: false,
  });
}

function notificationFailure(
  message: string,
  options: NotificationDeliveryOptions,
): NotificationDeliveryResult {
  try {
    options.on_failure?.(message);
  } catch {
    console.error(NOTIFICATION_FAILURE_REPORTING_MESSAGE);
  }
  return { status: 'failure', message };
}

export function createNotificationFailureOptions(
  log_event: (level: 'critical', message: string) => void,
): NotificationDeliveryOptions {
  return { on_failure: (message) => log_event('critical', message) };
}

async function loadNotificationPlugin(): Promise<NotificationPlugin> {
  notificationPluginPromise ??= import('@tauri-apps/plugin-notification');
  try {
    return await notificationPluginPromise;
  } catch (error: unknown) {
    notificationPluginPromise = undefined;
    throw error;
  }
}

export async function notify(
  title: string,
  body: string,
  options: NotificationDeliveryOptions = {},
): Promise<NotificationDeliveryResult> {
  if (!hasTauriBackend()) {
    return { status: 'skipped', reason: 'backend_unavailable' };
  }
  if (notificationsInFlight.has(body)) {
    return { status: 'skipped', reason: 'in_flight' };
  }
  const eligibility = getNotificationEligibility(body, Date.now());
  if (eligibility === 'failure') {
    return notificationFailure(NOTIFICATION_DEDUPE_FAILURE_MESSAGE, options);
  }
  if (eligibility === 'duplicate') {
    return { status: 'skipped', reason: 'duplicate' };
  }
  notificationsInFlight.add(body);
  try {
    // Dynamic import keeps the plugin out of the startup module graph.
    const { isPermissionGranted, requestPermission, sendNotification } =
      await loadNotificationPlugin();
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (!granted) {
      return notificationFailure(NOTIFICATION_PERMISSION_DENIED_MESSAGE, options);
    }
    sendNotification({ title, body });
    commitNotificationDelivery(body, Date.now());
    return { status: 'sent' };
  } catch {
    console.error(NOTIFICATION_DELIVERY_FAILURE_MESSAGE);
    return notificationFailure(NOTIFICATION_DELIVERY_FAILURE_MESSAGE, options);
  } finally {
    notificationsInFlight.delete(body);
  }
}

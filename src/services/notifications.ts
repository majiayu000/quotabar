import { hasTauriBackend } from './backend';
import { readStorageValue, writeStorageItem } from './storage';

export type NotificationKey = 'q80' | 'q95' | 'bonus';

export type NotificationSettings = Record<NotificationKey, boolean>;

export const NOTIFICATION_ROWS: Array<{ key: NotificationKey; label: string }> = [
  { key: 'q80', label: 'Alert at 80% used' },
  { key: 'q95', label: 'Critical alert at 95%' },
  { key: 'bonus', label: 'Bonus expiry reminders' },
];

const STORAGE_KEY = 'claude-quota-notifications';
/** One system notification per unique body within this window. */
const NOTIFY_DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;
const DEDUPE_STORAGE_KEY = 'claude-quota-notified';

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

export function shouldNotify(body: string, now: number = Date.now()): boolean {
  const result = loadNotified();
  if (result.status === 'failure') return false;
  const notified = result.status === 'value' ? result.value : {};
  const last = notified[body];
  if (typeof last === 'number' && now - last < NOTIFY_DEDUPE_WINDOW_MS) {
    return false;
  }
  const next: Record<string, number> = { [body]: now };
  for (const [key, value] of Object.entries(notified)) {
    if (typeof value === 'number' && now - value < NOTIFY_DEDUPE_WINDOW_MS) {
      next[key] = value;
    }
  }
  return writeStorageItem(DEDUPE_STORAGE_KEY, JSON.stringify(next), {
    preserveSessionValue: false,
    notifyUser: false,
  });
}

export async function notify(title: string, body: string): Promise<void> {
  if (!hasTauriBackend()) return;
  if (!shouldNotify(body)) return;
  try {
    // Dynamic import keeps the plugin out of the startup module graph.
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      '@tauri-apps/plugin-notification'
    );
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch (err) {
    console.error('Failed to send notification:', err);
  }
}

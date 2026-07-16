import { hasTauriBackend } from './backend';
import { readStorageItem, writeStorageItem } from './storage';

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
  try {
    const raw = readStorageItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    for (const { key } of NOTIFICATION_ROWS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') {
        defaults[key] = value;
      }
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function saveNotificationSettings(settings: NotificationSettings): boolean {
  return writeStorageItem(STORAGE_KEY, JSON.stringify(settings), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

function loadNotified(): Record<string, number> {
  try {
    const raw = readStorageItem(DEDUPE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function shouldNotify(body: string, now: number = Date.now()): boolean {
  const notified = loadNotified();
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
  try {
    localStorage.setItem(DEDUPE_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return true;
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

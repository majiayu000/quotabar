import { readStorageValue, writeStorageItem } from './storage';

export type EventLevel = 'info' | 'warning' | 'critical';

export interface AppEvent {
  id: string;
  time: string;
  level: EventLevel;
  text: string;
}

const STORAGE_KEY = 'claude-quota-events';
const MAX_EVENTS = 50;
/** Identical event text within this window is treated as a duplicate. */
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

export function getSavedEvents(): AppEvent[] {
  const result = readStorageValue(STORAGE_KEY, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isAppEvent)) {
      throw new Error('Invalid saved event history');
    }
    return parsed;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : [];
}

function isAppEvent(value: unknown): value is AppEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === 'string' &&
    typeof event.time === 'string' &&
    typeof event.text === 'string' &&
    (event.level === 'info' || event.level === 'warning' || event.level === 'critical')
  );
}

/**
 * Prepends an event and returns the updated list (newest first).
 * Repeats of the same text inside the dedupe window are dropped.
 */
export function recordEvent(
  events: AppEvent[],
  level: EventLevel,
  text: string,
  now: number = Date.now(),
): AppEvent[] {
  const duplicate = events.find(
    (event) => event.text === text && now - Date.parse(event.time) < DEDUPE_WINDOW_MS,
  );
  if (duplicate) return events;

  const next = [
    {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date(now).toISOString(),
      level,
      text,
    },
    ...events,
  ].slice(0, MAX_EVENTS);

  writeStorageItem(STORAGE_KEY, JSON.stringify(next), {
    preserveSessionValue: true,
    notifyUser: false,
  });
  return next;
}

export function formatEventTime(time: string, now: number = Date.now()): string {
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp)) return '';
  const diffMinutes = Math.floor((now - timestamp) / 60000);
  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

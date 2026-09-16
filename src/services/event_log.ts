import { getLocale, t, renderText, isDisplayText, type DisplayText } from '../i18n';
import { readStorageValue, writeStorageItem } from './storage';

export type EventLevel = 'info' | 'warning' | 'critical';

export interface AppEvent {
  id: string;
  time: string;
  level: EventLevel;
  text: DisplayText;
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
    isDisplayText(event.text) &&
    (event.level === 'info' || event.level === 'warning' || event.level === 'critical')
  );
}

/**
 * Prepends an event and returns the updated list (newest first).
 * Repeats of the same text inside the dedupe window are dropped.
 * This function is pure: persist separately with `persistEvents`.
 */
export function appendEvent(
  events: AppEvent[],
  level: EventLevel,
  text: DisplayText,
  now: number = Date.now(),
  id: string = `${now}-${Math.random().toString(36).slice(2, 8)}`,
): AppEvent[] {
  const duplicate = events.find(
    (event) => renderText(event.text, 'en') === renderText(text, 'en') && now - Date.parse(event.time) < DEDUPE_WINDOW_MS,
  );
  if (duplicate) return events;

  return [
    {
      id,
      time: new Date(now).toISOString(),
      level,
      text,
    },
    ...events,
  ].slice(0, MAX_EVENTS);
}

export function persistEvents(events: AppEvent[]): boolean {
  return writeStorageItem(STORAGE_KEY, JSON.stringify(events), {
    preserveSessionValue: true,
    notifyUser: false,
  });
}

export function recordEvent(
  events: AppEvent[],
  level: EventLevel,
  text: DisplayText,
  now: number = Date.now(),
): AppEvent[] {
  const next = appendEvent(events, level, text, now);
  persistEvents(next);
  return next;
}

export function formatEventTime(time: string, now: number = Date.now()): string {
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp)) return '';
  const diffMinutes = Math.floor((now - timestamp) / 60000);
  if (diffMinutes < 1) return t("now");
  if (diffMinutes < 60) return t("{p0}m ago", { p0: diffMinutes });
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return t("{p0}h ago", { p0: diffHours });
  return new Date(timestamp).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
}

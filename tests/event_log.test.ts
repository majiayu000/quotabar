import { afterEach, describe, expect, test } from 'vitest';
import { formatEventTime, getSavedEvents, recordEvent } from '../src/services/event_log';

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  return store;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

const NOW = Date.parse('2026-07-05T12:00:00Z');

describe('event log', () => {
  test('records newest first and persists', () => {
    installMemoryStorage();
    let events = recordEvent([], 'info', 'Claude connected', NOW);
    events = recordEvent(events, 'warning', 'Codex usage crossed 80%', NOW + 60000);

    expect(events[0].text).toBe('Codex usage crossed 80%');
    expect(events[1].text).toBe('Claude connected');
    expect(getSavedEvents()).toHaveLength(2);
  });

  test('dedupes identical text within 30 minutes', () => {
    installMemoryStorage();
    let events = recordEvent([], 'warning', 'Claude disconnected', NOW);
    events = recordEvent(events, 'warning', 'Claude disconnected', NOW + 5 * 60000);
    expect(events).toHaveLength(1);

    events = recordEvent(events, 'warning', 'Claude disconnected', NOW + 31 * 60000);
    expect(events).toHaveLength(2);
  });

  test('caps stored events at 50', () => {
    installMemoryStorage();
    let events: ReturnType<typeof recordEvent> = [];
    for (let i = 0; i < 60; i += 1) {
      events = recordEvent(events, 'info', `event ${i}`, NOW + i * 60 * 60000);
    }
    expect(events).toHaveLength(50);
    expect(events[0].text).toBe('event 59');
  });

  test('formats relative event times', () => {
    expect(formatEventTime(new Date(NOW - 30000).toISOString(), NOW)).toBe('now');
    expect(formatEventTime(new Date(NOW - 5 * 60000).toISOString(), NOW)).toBe('5m ago');
    expect(formatEventTime(new Date(NOW - 3 * 3600000).toISOString(), NOW)).toBe('3h ago');
    expect(formatEventTime('garbage', NOW)).toBe('');
  });
});

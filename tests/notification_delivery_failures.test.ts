import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify, shouldNotify } from '../src/services/notifications';

const notificationPlugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-notification', () => notificationPlugin);

const NOW = Date.parse('2026-07-16T12:00:00Z');

function installMemoryStorage(): Map<string, string> {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
  return values;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  installMemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  notificationPlugin.isPermissionGranted.mockResolvedValue(true);
  notificationPlugin.requestPermission.mockResolvedValue('granted');
  notificationPlugin.sendNotification.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).window;
});

describe('notification delivery commit', () => {
  it('commits the dedupe timestamp only after a successful send', async () => {
    const values = installMemoryStorage();

    await notify('QuotaBar', 'Claude usage crossed 80%');

    expect(notificationPlugin.sendNotification).toHaveBeenCalledExactlyOnceWith({
      title: 'QuotaBar',
      body: 'Claude usage crossed 80%',
    });
    expect(JSON.parse(values.get('claude-quota-notified') ?? '')).toEqual({
      'Claude usage crossed 80%': NOW,
    });
    expect(shouldNotify('Claude usage crossed 80%', NOW + 1)).toBe(false);
  });
});

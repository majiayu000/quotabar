import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_DEDUPE_FAILURE_MESSAGE,
  NOTIFICATION_DELIVERY_FAILURE_MESSAGE,
  NOTIFICATION_PERMISSION_DENIED_MESSAGE,
  notify,
  shouldNotify,
} from '../src/services/notifications';

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

function installReadFailure(): ReturnType<typeof vi.fn> {
  const setItem = vi.fn();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        throw new Error('dedupe-key=private-value');
      },
      setItem,
    },
  });
  return setItem;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  installMemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  notificationPlugin.isPermissionGranted.mockReset().mockResolvedValue(true);
  notificationPlugin.requestPermission.mockReset().mockResolvedValue('granted');
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

    const result = await notify('QuotaBar', 'Claude usage crossed 80%');

    expect(result).toEqual({ status: 'sent' });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledExactlyOnceWith({
      title: 'QuotaBar',
      body: 'Claude usage crossed 80%',
    });
    expect(JSON.parse(values.get('claude-quota-notified') ?? '')).toEqual({
      'Claude usage crossed 80%': NOW,
    });
    expect(shouldNotify('Claude usage crossed 80%', NOW + 1)).toBe(false);
  });

  it('returns typed skipped outcomes for browser preview and recent duplicates', async () => {
    delete (globalThis as Record<string, unknown>).window;
    await expect(notify('QuotaBar', 'browser')).resolves.toEqual({
      status: 'skipped',
      reason: 'backend_unavailable',
    });
    expect(notificationPlugin.isPermissionGranted).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    localStorage.setItem('claude-quota-notified', JSON.stringify({ recent: NOW }));
    await expect(notify('QuotaBar', 'recent')).resolves.toEqual({
      status: 'skipped',
      reason: 'duplicate',
    });
    expect(notificationPlugin.sendNotification).not.toHaveBeenCalled();
  });

  it('reports a dedupe read failure once without committing and retries after recovery', async () => {
    const setItem = installReadFailure();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFailure = vi.fn();

    await expect(notify('QuotaBar', 'retry read', { on_failure: onFailure })).resolves.toEqual({
      status: 'failure',
      message: NOTIFICATION_DEDUPE_FAILURE_MESSAGE,
    });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(NOTIFICATION_DEDUPE_FAILURE_MESSAGE);
    expect(setItem).not.toHaveBeenCalled();
    expect(notificationPlugin.sendNotification).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private-value');

    installMemoryStorage();
    await expect(notify('QuotaBar', 'retry read')).resolves.toEqual({ status: 'sent' });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('does not commit permission denial and permits a later retry', async () => {
    const values = installMemoryStorage();
    const onFailure = vi.fn();
    notificationPlugin.isPermissionGranted.mockResolvedValue(false);
    notificationPlugin.requestPermission.mockResolvedValue('denied');

    await expect(notify('QuotaBar', 'retry permission', { on_failure: onFailure })).resolves.toEqual({
      status: 'failure',
      message: NOTIFICATION_PERMISSION_DENIED_MESSAGE,
    });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(NOTIFICATION_PERMISSION_DENIED_MESSAGE);
    expect(notificationPlugin.sendNotification).not.toHaveBeenCalled();
    expect(values.has('claude-quota-notified')).toBe(false);

    notificationPlugin.requestPermission.mockResolvedValue('granted');
    await expect(notify('QuotaBar', 'retry permission')).resolves.toEqual({ status: 'sent' });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['permission check', () => notificationPlugin.isPermissionGranted.mockRejectedValue(new Error('permission-token'))],
    ['permission request', () => {
      notificationPlugin.isPermissionGranted.mockResolvedValue(false);
      notificationPlugin.requestPermission.mockRejectedValue(new Error('request-token'));
    }],
    ['send', () => notificationPlugin.sendNotification.mockImplementation(() => {
      throw new Error('body-token');
    })],
  ])('does not commit a %s failure and permits retry', async (_name, arrangeFailure) => {
    const values = installMemoryStorage();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFailure = vi.fn();
    arrangeFailure();

    await expect(notify('QuotaBar', 'retry delivery', { on_failure: onFailure })).resolves.toEqual({
      status: 'failure',
      message: NOTIFICATION_DELIVERY_FAILURE_MESSAGE,
    });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(NOTIFICATION_DELIVERY_FAILURE_MESSAGE);
    expect(values.has('claude-quota-notified')).toBe(false);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(NOTIFICATION_DELIVERY_FAILURE_MESSAGE);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('token');

    notificationPlugin.isPermissionGranted.mockReset().mockResolvedValue(true);
    notificationPlugin.requestPermission.mockReset().mockResolvedValue('granted');
    notificationPlugin.sendNotification.mockReset();
    await expect(notify('QuotaBar', 'retry delivery')).resolves.toEqual({ status: 'sent' });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('does not commit a plugin load failure and permits retry after module recovery', async () => {
    const values = installMemoryStorage();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFailure = vi.fn();
    vi.doMock('@tauri-apps/plugin-notification', () => {
      throw new Error('plugin-token');
    });
    vi.resetModules();
    const failedModule = await import('../src/services/notifications');

    await expect(failedModule.notify('QuotaBar', 'retry plugin', {
      on_failure: onFailure,
    })).resolves.toEqual({
      status: 'failure',
      message: NOTIFICATION_DELIVERY_FAILURE_MESSAGE,
    });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(NOTIFICATION_DELIVERY_FAILURE_MESSAGE);
    expect(values.has('claude-quota-notified')).toBe(false);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(NOTIFICATION_DELIVERY_FAILURE_MESSAGE);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('plugin-token');

    vi.doMock('@tauri-apps/plugin-notification', () => notificationPlugin);
    vi.resetModules();
    const recoveredModule = await import('../src/services/notifications');
    await expect(recoveredModule.notify('QuotaBar', 'retry plugin')).resolves.toEqual({
      status: 'sent',
    });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed result when the failure callback throws and logs no original error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    notificationPlugin.isPermissionGranted.mockResolvedValue(false);
    notificationPlugin.requestPermission.mockResolvedValue('denied');

    await expect(notify('QuotaBar', 'callback', {
      on_failure: () => {
        throw new Error('callback-secret');
      },
    })).resolves.toEqual({
      status: 'failure',
      message: NOTIFICATION_PERMISSION_DENIED_MESSAGE,
    });
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      'Failed to report notification delivery failure.',
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('callback-secret');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_DEDUPE_FAILURE_MESSAGE,
  NOTIFICATION_DELIVERY_FAILURE_MESSAGE,
  NOTIFICATION_PERMISSION_DENIED_MESSAGE,
  notify,
  shouldNotify,
} from '../src/services/notifications';
import { writeStorageItem } from '../src/services/storage';

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

function installCommitReadFailure(): ReturnType<typeof vi.fn> {
  let reads = 0;
  const setItem = vi.fn();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        reads += 1;
        if (reads === 1) return null;
        throw new Error('post-send-read-token');
      },
      setItem,
    },
  });
  return setItem;
}

function installWriteFailure(): ReturnType<typeof vi.fn> {
  const setItem = vi.fn(() => {
    throw new Error('post-send-write-token');
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
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
  installMemoryStorage();
  writeStorageItem('claude-quota-notified', '{}', {
    preserveSessionValue: false,
    notifyUser: false,
  });
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
  ])('does not commit a %s failure and permits retry', async (name, arrangeFailure) => {
    const values = installMemoryStorage();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFailure = vi.fn();
    const body = `retry ${name}`;
    arrangeFailure();

    await expect(notify('QuotaBar', body, { on_failure: onFailure })).resolves.toEqual({
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
    await expect(notify('QuotaBar', body)).resolves.toEqual({ status: 'sent' });
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

  it('coalesces concurrent delivery of the same body and releases the guard', async () => {
    let resolvePermission: ((granted: boolean) => void) | undefined;
    notificationPlugin.isPermissionGranted.mockReturnValue(new Promise<boolean>((resolve) => {
      resolvePermission = resolve;
    }));

    const first = notify('QuotaBar', 'same concurrent body');
    const second = notify('QuotaBar', 'same concurrent body');
    await expect(second).resolves.toEqual({ status: 'skipped', reason: 'in_flight' });
    resolvePermission?.(true);
    await expect(first).resolves.toEqual({ status: 'sent' });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);

    await expect(notify('QuotaBar', 'same concurrent body')).resolves.toEqual({
      status: 'skipped',
      reason: 'duplicate',
    });
  });

  it('merges different-body concurrent commits without losing either timestamp', async () => {
    const values = installMemoryStorage();

    const results = await Promise.all([
      notify('QuotaBar', 'concurrent body A'),
      notify('QuotaBar', 'concurrent body B'),
    ]);

    expect(notificationPlugin.isPermissionGranted).toHaveBeenCalledTimes(2);
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(2);
    expect(results).toEqual([{ status: 'sent' }, { status: 'sent' }]);

    expect(JSON.parse(values.get('claude-quota-notified') ?? '')).toEqual({
      'concurrent body A': NOW,
      'concurrent body B': NOW,
    });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(2);
    await expect(notify('QuotaBar', 'concurrent body A')).resolves.toEqual({
      status: 'skipped',
      reason: 'duplicate',
    });
    await expect(notify('QuotaBar', 'concurrent body B')).resolves.toEqual({
      status: 'skipped',
      reason: 'duplicate',
    });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('returns sent and session-dedupes after a post-send fresh-read failure', async () => {
    const setItem = installCommitReadFailure();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notify('QuotaBar', 'post-send read failure')).resolves.toEqual({
      status: 'sent',
    });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to access local storage.');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('post-send-read-token');

    await expect(notify('QuotaBar', 'post-send read failure')).resolves.toEqual({
      status: 'skipped',
      reason: 'duplicate',
    });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('returns sent and session-dedupes after a post-send persistent write failure', async () => {
    const setItem = installWriteFailure();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notify('QuotaBar', 'post-send write failure')).resolves.toEqual({
      status: 'sent',
    });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      'Failed to persist local setting:',
      expect.any(Error),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('post-send-write-token');

    await expect(notify('QuotaBar', 'post-send write failure')).resolves.toEqual({
      status: 'skipped',
      reason: 'duplicate',
    });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('prunes the session timestamp after the 12-hour window', async () => {
    await expect(notify('QuotaBar', 'session expiry')).resolves.toEqual({ status: 'sent' });
    vi.setSystemTime(NOW + 13 * 60 * 60 * 1_000);

    await expect(notify('QuotaBar', 'session expiry')).resolves.toEqual({ status: 'sent' });
    expect(notificationPlugin.sendNotification).toHaveBeenCalledTimes(2);
  });
});

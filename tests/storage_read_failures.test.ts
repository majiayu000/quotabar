import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readStorageValue,
  subscribeStorageReadFailures,
  writeStorageItem,
} from '../src/services/storage';

function installMemoryStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
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

function installReadFailure(error: Error): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        throw error;
      },
      setItem: () => undefined,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('typed storage read adapter', () => {
  it('distinguishes decoded values from missing values', () => {
    installMemoryStorage({ present: '42' });

    expect(readStorageValue('present', Number, { notifyUser: false })).toEqual({
      status: 'value',
      value: 42,
    });
    expect(readStorageValue('missing', Number, { notifyUser: false })).toEqual({
      status: 'missing',
    });
  });

  it('reads and decodes the failed-write session shadow first', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => 'persisted',
        setItem: () => {
          throw new Error('write unavailable');
        },
      },
    });

    expect(writeStorageItem('shadow-read', 'session', {
      preserveSessionValue: true,
      notifyUser: false,
    })).toBe(false);
    expect(readStorageValue('shadow-read', (raw) => raw.toUpperCase(), {
      notifyUser: false,
    })).toEqual({ status: 'value', value: 'SESSION' });
    expect(consoleError).toHaveBeenCalledTimes(1);

    installMemoryStorage();
    expect(writeStorageItem('shadow-read', 'cleanup')).toBe(true);
  });

  it('uses fixed access and decode logs without exposing exception or raw sentinels', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installReadFailure(new Error('secret-key=secret-value'));

    expect(readStorageValue('secret-key', (raw) => raw, { notifyUser: false })).toEqual({
      status: 'failure',
    });
    expect(consoleError).toHaveBeenNthCalledWith(1, 'Failed to access local storage.');

    installMemoryStorage({ 'secret-key': 'raw-secret-value' });
    expect(readStorageValue('secret-key', () => {
      throw new Error('raw-secret-value');
    }, { notifyUser: false })).toEqual({ status: 'failure' });
    expect(consoleError).toHaveBeenNthCalledWith(2, 'Failed to decode local storage value.');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret-key');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret-value');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('raw-secret-value');
  });

  it('coalesces pending failures and stops after unsubscribe', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installReadFailure(new Error('unavailable'));

    readStorageValue('one', (raw) => raw, { notifyUser: true });
    readStorageValue('two', (raw) => raw, { notifyUser: true });
    const listener = vi.fn();
    const unsubscribe = subscribeStorageReadFailures(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    readStorageValue('three', (raw) => raw, { notifyUser: true });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    readStorageValue('four', (raw) => raw, { notifyUser: true });
    expect(listener).toHaveBeenCalledTimes(2);

    const consumePending = vi.fn();
    const unsubscribePending = subscribeStorageReadFailures(consumePending);
    expect(consumePending).toHaveBeenCalledTimes(1);
    unsubscribePending();
  });

  it('logs a listener failure and continues notifying other listeners', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installReadFailure(new Error('unavailable'));
    const unsubscribeThrowing = subscribeStorageReadFailures(() => {
      throw new Error('listener secret');
    });
    const listener = vi.fn();
    const unsubscribeListener = subscribeStorageReadFailures(listener);

    expect(readStorageValue('setting', (raw) => raw, { notifyUser: true })).toEqual({
      status: 'failure',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenNthCalledWith(1, 'Failed to access local storage.');
    expect(consoleError).toHaveBeenNthCalledWith(
      2,
      'Failed to report local storage read failure.',
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('listener secret');

    unsubscribeThrowing();
    unsubscribeListener();
  });
});

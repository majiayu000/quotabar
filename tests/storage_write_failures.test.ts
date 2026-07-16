import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readStorageItem,
  subscribeStorageWriteFailures,
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

function installThrowingStorage(error: Error): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw error;
      },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('storage write adapter', () => {
  it('writes successfully and reads the persisted value', () => {
    const values = installMemoryStorage();

    expect(writeStorageItem('success-key', 'saved')).toBe(true);
    expect(values.get('success-key')).toBe('saved');
    expect(readStorageItem('success-key')).toBe('saved');
  });

  it('preserves a failed value for the session and reports the original error', () => {
    const error = new Error('storage unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installThrowingStorage(error);

    expect(writeStorageItem('shadow-key', 'session-value', {
      preserveSessionValue: true,
      notifyUser: false,
    })).toBe(false);
    expect(readStorageItem('shadow-key')).toBe('session-value');
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      'Failed to persist local setting:',
      error,
    );
  });

  it('clears a stale shadow after storage recovers', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installThrowingStorage(new Error('quota exceeded'));
    expect(writeStorageItem('recovery-key', 'stale', {
      preserveSessionValue: true,
      notifyUser: false,
    })).toBe(false);

    installMemoryStorage();
    expect(writeStorageItem('recovery-key', 'persisted')).toBe(true);
    expect(readStorageItem('recovery-key')).toBe('persisted');
  });

  it('notifies subscribers once and stops after unsubscribe', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installThrowingStorage(new Error('denied'));
    const listener = vi.fn();
    const unsubscribe = subscribeStorageWriteFailures(listener);

    expect(writeStorageItem('notify-key', 'first', {
      preserveSessionValue: false,
      notifyUser: true,
    })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(writeStorageItem('notify-key', 'second', {
      preserveSessionValue: false,
      notifyUser: true,
    })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readStorageItem('notify-key')).toBeNull();
  });

  it('logs a subscriber error and continues reporting the storage failure', () => {
    const storageError = new Error('denied');
    const listenerError = new Error('listener failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installThrowingStorage(storageError);
    const unsubscribe = subscribeStorageWriteFailures(() => {
      throw listenerError;
    });

    expect(writeStorageItem('listener-error-key', 'value', {
      preserveSessionValue: false,
      notifyUser: true,
    })).toBe(false);
    expect(consoleError).toHaveBeenNthCalledWith(
      1,
      'Failed to report local storage write failure:',
      listenerError,
    );
    expect(consoleError).toHaveBeenNthCalledWith(
      2,
      'Failed to persist local setting:',
      storageError,
    );

    unsubscribe();
  });
});

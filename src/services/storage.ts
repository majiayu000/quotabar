export const STORAGE_WRITE_FAILURE_MESSAGE =
  'Your change applies to this session, but could not be saved.';
export const STORAGE_READ_FAILURE_MESSAGE =
  'Saved data could not be loaded. Default values are being used.';

export type StorageReadResult<T> =
  | { status: 'missing' }
  | { status: 'value'; value: T }
  | { status: 'failure' };

export interface StorageReadOptions {
  notifyUser: boolean;
}

export interface StorageWriteOptions {
  preserveSessionValue: boolean;
  notifyUser: boolean;
}

type StorageWriteFailureListener = () => void;
type StorageReadFailureListener = () => void;

const failedWriteShadow = new Map<string, string>();
const failureListeners = new Set<StorageWriteFailureListener>();
const readFailureListeners = new Set<StorageReadFailureListener>();
let pendingReadFailure = false;

const DEFAULT_WRITE_OPTIONS: StorageWriteOptions = {
  preserveSessionValue: false,
  notifyUser: false,
};

export function readStorageItem(key: string): string | null {
  if (failedWriteShadow.has(key)) {
    return failedWriteShadow.get(key) ?? null;
  }
  return localStorage.getItem(key);
}

function callReadFailureListener(listener: StorageReadFailureListener): void {
  try {
    listener();
  } catch {
    console.error('Failed to report local storage read failure.');
  }
}

function reportReadFailure(notifyUser: boolean): void {
  if (!notifyUser) return;
  if (readFailureListeners.size === 0) {
    pendingReadFailure = true;
    return;
  }
  for (const listener of readFailureListeners) {
    callReadFailureListener(listener);
  }
}

export function readStorageValue<T>(
  key: string,
  decode: (raw: string) => T,
  options: StorageReadOptions,
): StorageReadResult<T> {
  let raw: string | null;
  try {
    const shadowValue = failedWriteShadow.get(key);
    raw = shadowValue === undefined ? localStorage.getItem(key) : shadowValue;
  } catch {
    console.error('Failed to access local storage.');
    reportReadFailure(options.notifyUser);
    return { status: 'failure' };
  }

  if (raw === null) return { status: 'missing' };

  try {
    return { status: 'value', value: decode(raw) };
  } catch {
    console.error('Failed to decode local storage value.');
    reportReadFailure(options.notifyUser);
    return { status: 'failure' };
  }
}

export function subscribeStorageReadFailures(
  listener: StorageReadFailureListener,
): () => void {
  readFailureListeners.add(listener);
  if (pendingReadFailure) {
    pendingReadFailure = false;
    callReadFailureListener(listener);
  }
  return () => {
    readFailureListeners.delete(listener);
  };
}

export function writeStorageItem(
  key: string,
  value: string,
  options: StorageWriteOptions = DEFAULT_WRITE_OPTIONS,
): boolean {
  try {
    localStorage.setItem(key, value);
    failedWriteShadow.delete(key);
    return true;
  } catch (error: unknown) {
    if (options.preserveSessionValue) {
      failedWriteShadow.set(key, value);
    } else {
      failedWriteShadow.delete(key);
    }

    if (options.notifyUser) {
      for (const listener of failureListeners) {
        try {
          listener();
        } catch (listenerError: unknown) {
          console.error('Failed to report local storage write failure:', listenerError);
        }
      }
    }

    console.error('Failed to persist local setting:', error);
    return false;
  }
}

export function subscribeStorageWriteFailures(
  listener: StorageWriteFailureListener,
): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

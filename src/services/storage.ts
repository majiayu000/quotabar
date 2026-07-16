export const STORAGE_WRITE_FAILURE_MESSAGE =
  'Your change applies to this session, but could not be saved.';

export interface StorageWriteOptions {
  preserveSessionValue: boolean;
  notifyUser: boolean;
}

type StorageWriteFailureListener = () => void;

const failedWriteShadow = new Map<string, string>();
const failureListeners = new Set<StorageWriteFailureListener>();

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

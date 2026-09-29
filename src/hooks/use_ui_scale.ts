import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { hasTauriBackend } from '../services/backend';
import { readStorageValue, writeStorageItem } from '../services/storage';

export const UI_SCALE_KEY = 'quotabar-ui-scale';
export const UI_SCALES = [1, 1.25, 1.5] as const;
export type UiScale = typeof UI_SCALES[number];
export const UI_SCALE_ERROR = 'Could not change interface size. Please try again.';

export function getSavedUiScale(): UiScale {
  const result = readStorageValue(UI_SCALE_KEY, (raw) => {
    const scale = Number(raw);
    if (!UI_SCALES.includes(scale as UiScale)) throw new Error('Invalid interface size');
    return scale as UiScale;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : 1;
}

export function useUiScale(onError: (message: string) => void) {
  const [scale, setScale] = useState<UiScale>(1);
  const [busy, setBusy] = useState(true);
  const generation = useRef(0);

  const apply = useCallback(async (next: UiScale, persist: boolean) => {
    const request = ++generation.current;
    setBusy(true);
    try {
      if (hasTauriBackend()) {
        await getCurrentWebview().setZoom(next);
      } else if (typeof document !== 'undefined') {
        document.documentElement.style.zoom = String(next);
      }
      if (request !== generation.current) return;
      setScale(next);
      if (persist) {
        writeStorageItem(UI_SCALE_KEY, String(next), { preserveSessionValue: true, notifyUser: true });
      }
    } catch {
      if (request === generation.current) onError(UI_SCALE_ERROR);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }, [onError]);

  useEffect(() => {
    void apply(getSavedUiScale(), false);
    const sync = (event: StorageEvent) => {
      if (event.key === UI_SCALE_KEY || event.key === null) void apply(getSavedUiScale(), false);
    };
    if (typeof window !== 'undefined') window.addEventListener('storage', sync);
    return () => {
      ++generation.current;
      if (typeof window !== 'undefined') window.removeEventListener('storage', sync);
    };
  }, [apply]);

  return { scale, busy, changeScale: (next: UiScale) => apply(next, true) };
}

import { readStorageValue, writeStorageItem } from './storage';

export const TEXT_SCALES = [1, 1.15, 1.3] as const;
export type TextScale = typeof TEXT_SCALES[number];
export const TEXT_SCALE_STORAGE_KEY = 'quotabar-text-scale';

export function isTextScale(value: unknown): value is TextScale {
  return TEXT_SCALES.some((scale) => value === scale);
}

export function getSavedTextScale(): TextScale {
  const result = readStorageValue(TEXT_SCALE_STORAGE_KEY, (raw) => {
    const value: unknown = JSON.parse(raw);
    if (!isTextScale(value)) throw new Error('Invalid saved text size');
    return value;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : 1;
}

export function saveTextScale(scale: TextScale): boolean {
  return writeStorageItem(TEXT_SCALE_STORAGE_KEY, JSON.stringify(scale), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

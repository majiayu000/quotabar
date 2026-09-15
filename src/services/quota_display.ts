import { readStorageValue, writeStorageItem } from './storage';

export interface QuotaDisplay {
  value: 'remaining' | 'used';
  weekly: boolean;
}

export const DEFAULT_QUOTA_DISPLAY: QuotaDisplay = { value: 'remaining', weekly: true };
const STORAGE_KEY = 'quotabar-quota-display';

export function getSavedQuotaDisplay(): QuotaDisplay {
  const result = readStorageValue(STORAGE_KEY, (raw) => {
    const value = JSON.parse(raw);
    if (!value || !['remaining', 'used'].includes(value.value) || typeof value.weekly !== 'boolean') {
      throw new Error('Invalid saved quota display');
    }
    return { value: value.value, weekly: value.weekly } as QuotaDisplay;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : DEFAULT_QUOTA_DISPLAY;
}

export function saveQuotaDisplay(display: QuotaDisplay): boolean {
  return writeStorageItem(STORAGE_KEY, JSON.stringify(display), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

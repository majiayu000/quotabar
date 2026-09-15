import { SERVICES } from './service_meta';
import type { TrayServiceName } from './tray_visibility';
import { readStorageValue, writeStorageItem } from './storage';

export const MAX_PROVIDER_FAVORITES = 3;
const KEY = 'quotabar-provider-favorites';

/** null means no preference yet; an empty list means deliberately no favorites. */
export function getSavedProviderFavorites(): TrayServiceName[] | null {
  const result = readStorageValue(KEY, (raw) => {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > MAX_PROVIDER_FAVORITES || new Set(value).size !== value.length
      || !value.every((id) => SERVICES.includes(id))) throw new Error('Invalid saved provider favorites');
    return value as TrayServiceName[];
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : null;
}

export function saveProviderFavorites(favorites: TrayServiceName[]): boolean {
  return writeStorageItem(KEY, JSON.stringify(favorites), { preserveSessionValue: true, notifyUser: true });
}

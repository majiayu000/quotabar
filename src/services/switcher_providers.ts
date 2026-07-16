import { SERVICES } from './service_meta';
import { readStorageValue, writeStorageItem } from './storage';
import type { TrayServiceName } from './tray_visibility';

export type SwitcherVisibility = Record<TrayServiceName, boolean>;

const STORAGE_KEY = 'claude-quota-switcher-providers';

export function defaultSwitcherVisibility(): SwitcherVisibility {
  return SERVICES.reduce((acc, svc) => {
    acc[svc] = true;
    return acc;
  }, {} as SwitcherVisibility);
}

export function getSavedSwitcherVisibility(): SwitcherVisibility {
  const defaults = defaultSwitcherVisibility();
  const result = readStorageValue(STORAGE_KEY, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid saved switcher visibility');
    }
    for (const svc of SERVICES) {
      const value = (parsed as Record<string, unknown>)[svc];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') throw new Error('Invalid saved switcher value');
      defaults[svc] = value;
    }
    if (!SERVICES.some((svc) => defaults[svc])) {
      throw new Error('At least one switcher provider must remain visible');
    }
    return defaults;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : defaultSwitcherVisibility();
}

export function saveSwitcherVisibility(visibility: SwitcherVisibility): boolean {
  return writeStorageItem(STORAGE_KEY, JSON.stringify(visibility), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

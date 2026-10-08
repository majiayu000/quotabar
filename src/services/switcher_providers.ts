import { ALL_SERVICES, SERVICES, isHiddenService } from './service_meta';
import { readStorageValue, writeStorageItem } from './storage';
import type { TrayServiceName } from './tray_visibility';

export type SwitcherVisibility = Record<TrayServiceName, boolean>;

const STORAGE_KEY = 'claude-quota-switcher-providers';

export function defaultSwitcherVisibility(): SwitcherVisibility {
  return ALL_SERVICES.reduce((acc, svc) => {
    acc[svc] = SERVICES.includes(svc);
    return acc;
  }, {} as SwitcherVisibility);
}

export function getSavedSwitcherVisibility(): SwitcherVisibility | null {
  const defaults = defaultSwitcherVisibility();
  const result = readStorageValue<SwitcherVisibility | null>(STORAGE_KEY, (raw) => {
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
      // A preference that only kept hidden providers is stale, not corrupt: fall back to detection.
      if (Object.entries(parsed).some(([svc, value]) => value === true && isHiddenService(svc))) return null;
      throw new Error('At least one switcher provider must remain visible');
    }
    return defaults;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : null;
}

export function saveSwitcherVisibility(visibility: SwitcherVisibility): boolean {
  return writeStorageItem(STORAGE_KEY, JSON.stringify(visibility), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

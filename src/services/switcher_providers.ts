import { SERVICES } from './service_meta';
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    for (const svc of SERVICES) {
      const value = (parsed as Record<string, unknown>)[svc];
      if (typeof value === 'boolean') {
        defaults[svc] = value;
      }
    }
    // The switcher needs at least one provider next to Overview.
    if (!SERVICES.some((svc) => defaults[svc])) {
      return defaultSwitcherVisibility();
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function saveSwitcherVisibility(visibility: SwitcherVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch {}
}

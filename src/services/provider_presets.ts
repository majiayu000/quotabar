import { ALL_SERVICES, SERVICE_META, SERVICES } from './service_meta';
import type { SwitcherVisibility } from './switcher_providers';
import type { TrayServiceName } from './tray_visibility';

export type ProviderPreset = 'all' | TrayServiceName;

export interface ProviderPresetPlan {
  switcher: SwitcherVisibility;
  trays: Record<TrayServiceName, boolean>;
}

export function planProviderPreset(
  _currentSwitcher: SwitcherVisibility,
  currentTrays: Record<TrayServiceName, boolean>,
  preset: ProviderPreset,
): ProviderPresetPlan {
  if (preset === 'all') {
    const switcher = ALL_SERVICES.reduce((acc, service) => {
      acc[service] = SERVICES.includes(service);
      return acc;
    }, {} as SwitcherVisibility);
    return { switcher, trays: { ...currentTrays } };
  }

  const switcher = ALL_SERVICES.reduce((acc, service) => {
    acc[service] = service === preset && SERVICES.includes(service);
    return acc;
  }, {} as SwitcherVisibility);

  return { switcher, trays: { ...currentTrays, [preset]: true } };
}

export function planRevealProviderPanel(
  current: SwitcherVisibility,
  service: TrayServiceName,
): SwitcherVisibility {
  if (current[service]) return current;
  return { ...current, [service]: true };
}

export function matchProviderInEventText(text: string): TrayServiceName | null {
  let found: TrayServiceName | null = null;
  let bestLength = 0;
  for (const service of SERVICES) {
    const label = SERVICE_META[service].label;
    if (text.includes(label) && label.length > bestLength) {
      found = service;
      bestLength = label.length;
    }
  }
  return found;
}

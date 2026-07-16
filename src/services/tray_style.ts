import { readStorageValue, writeStorageItem } from './storage';

export type TrayStyle = 'percent' | 'ring' | 'icon';

export const TRAY_STYLE_OPTIONS: Array<{ id: TrayStyle; label: string }> = [
  { id: 'percent', label: 'Percent' },
  { id: 'ring', label: 'Ring' },
  { id: 'icon', label: 'Icon only' },
];

const STYLE_STORAGE_KEY = 'claude-quota-tray-style';
const CYCLE_STORAGE_KEY = 'claude-quota-tray-cycle';

const VALID_STYLES = new Set<string>(TRAY_STYLE_OPTIONS.map((option) => option.id));

export function getSavedTrayStyle(): TrayStyle {
  const result = readStorageValue(STYLE_STORAGE_KEY, (raw) => {
    if (!VALID_STYLES.has(raw)) throw new Error('Invalid saved tray style');
    return raw as TrayStyle;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : 'percent';
}

export function saveTrayStyle(style: TrayStyle): boolean {
  return writeStorageItem(STYLE_STORAGE_KEY, style, {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

export function getSavedTrayCycle(): boolean {
  const result = readStorageValue(CYCLE_STORAGE_KEY, (raw) => {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error('Invalid saved tray cycle');
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : false;
}

export function saveTrayCycle(enabled: boolean): boolean {
  return writeStorageItem(CYCLE_STORAGE_KEY, String(enabled), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

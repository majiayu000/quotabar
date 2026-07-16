import { readStorageItem, writeStorageItem } from './storage';

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
  try {
    const saved = readStorageItem(STYLE_STORAGE_KEY);
    if (saved && VALID_STYLES.has(saved)) {
      return saved as TrayStyle;
    }
  } catch {}
  return 'percent';
}

export function saveTrayStyle(style: TrayStyle): boolean {
  return writeStorageItem(STYLE_STORAGE_KEY, style, {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

export function getSavedTrayCycle(): boolean {
  try {
    return readStorageItem(CYCLE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveTrayCycle(enabled: boolean): boolean {
  return writeStorageItem(CYCLE_STORAGE_KEY, String(enabled), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

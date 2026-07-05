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
    const saved = localStorage.getItem(STYLE_STORAGE_KEY);
    if (saved && VALID_STYLES.has(saved)) {
      return saved as TrayStyle;
    }
  } catch {}
  return 'percent';
}

export function saveTrayStyle(style: TrayStyle): void {
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, style);
  } catch {}
}

export function getSavedTrayCycle(): boolean {
  try {
    return localStorage.getItem(CYCLE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveTrayCycle(enabled: boolean): void {
  try {
    localStorage.setItem(CYCLE_STORAGE_KEY, String(enabled));
  } catch {}
}

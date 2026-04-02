export type TrayServiceName = 'claude' | 'codex';

const TRAY_STORAGE_KEYS: Record<TrayServiceName, string> = {
  claude: 'claude-tray-enabled',
  codex: 'codex-tray-enabled',
};

export function getSavedTrayEnabled(service: TrayServiceName): boolean {
  try {
    const saved = localStorage.getItem(TRAY_STORAGE_KEYS[service]);
    if (saved === 'false') return false;
  } catch {}
  return true;
}

export function saveTrayEnabled(service: TrayServiceName, enabled: boolean): void {
  try {
    localStorage.setItem(TRAY_STORAGE_KEYS[service], String(enabled));
  } catch {}
}

export function shouldShowTray(enabled: boolean, _connected: boolean): boolean {
  return enabled;
}

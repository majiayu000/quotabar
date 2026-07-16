import { readStorageItem, writeStorageItem } from './storage';

export type TrayServiceName = 'claude' | 'codex' | 'cursor' | 'antigravity';

const TRAY_STORAGE_KEYS: Record<TrayServiceName, string> = {
  claude: 'claude-tray-enabled',
  codex: 'codex-tray-enabled',
  cursor: 'cursor-tray-enabled',
  antigravity: 'antigravity-tray-enabled',
};

const TRAY_DEFAULT_ENABLED: Record<TrayServiceName, boolean> = {
  claude: true,
  codex: true,
  cursor: true,
  antigravity: false,
};

export function getSavedTrayEnabled(service: TrayServiceName): boolean {
  try {
    const saved = readStorageItem(TRAY_STORAGE_KEYS[service]);
    if (saved === 'false') return false;
    if (saved === 'true') return true;
  } catch {}
  return TRAY_DEFAULT_ENABLED[service];
}

export function saveTrayEnabled(service: TrayServiceName, enabled: boolean): boolean {
  return writeStorageItem(TRAY_STORAGE_KEYS[service], String(enabled), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

export function shouldShowTray(enabled: boolean, _connected: boolean): boolean {
  return enabled;
}

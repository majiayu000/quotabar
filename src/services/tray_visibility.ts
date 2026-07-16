import { readStorageValue, writeStorageItem } from './storage';

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
  const result = readStorageValue(TRAY_STORAGE_KEYS[service], (raw) => {
    if (raw === 'false') return false;
    if (raw === 'true') return true;
    throw new Error('Invalid saved tray visibility');
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : TRAY_DEFAULT_ENABLED[service];
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

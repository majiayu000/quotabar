import { readStorageValue, writeStorageItem } from './storage';

export type TrayServiceName = 'claude' | 'codex' | 'cursor' | 'grok' | 'antigravity';

const TRAY_STORAGE_KEYS: Record<TrayServiceName, string> = {
  claude: 'claude-tray-enabled',
  codex: 'codex-tray-enabled',
  cursor: 'cursor-tray-enabled',
  grok: 'grok-tray-enabled',
  antigravity: 'antigravity-tray-enabled',
};

const TRAY_DEFAULT_ENABLED: Record<TrayServiceName, boolean> = {
  claude: true,
  codex: true,
  cursor: true,
  grok: true,
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

export function resolveTrayVisible(
  service: TrayServiceName,
  candidates: readonly TrayServiceName[],
  cycle: boolean,
  cycleIndex: number,
): boolean {
  if (!candidates.includes(service)) {
    return false;
  }
  if (cycle && candidates.length > 1) {
    return service === candidates[cycleIndex % candidates.length];
  }
  return true;
}

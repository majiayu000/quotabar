import { hasTauriBackend } from './backend';

export const AUTOSTART_STATUS_FAILURE_MESSAGE =
  'Launch at Login status could not be read. The toggle stays off.';
export const AUTOSTART_UPDATE_FAILURE_MESSAGE =
  'Launch at Login could not be updated. The system login item was left unchanged.';

export type AutostartReadResult =
  | { status: 'ok'; enabled: boolean }
  | { status: 'unavailable' }
  | { status: 'failure'; message: string };

export type AutostartWriteResult =
  | { status: 'ok'; enabled: boolean }
  | { status: 'failure'; message: string };

type AutostartPlugin = typeof import('@tauri-apps/plugin-autostart');
let autostartPluginPromise: Promise<AutostartPlugin> | undefined;

async function loadAutostartPlugin(): Promise<AutostartPlugin> {
  autostartPluginPromise ??= import('@tauri-apps/plugin-autostart');
  try {
    return await autostartPluginPromise;
  } catch {
    autostartPluginPromise = undefined;
    throw new Error(AUTOSTART_STATUS_FAILURE_MESSAGE);
  }
}

export async function readAutostartEnabled(): Promise<AutostartReadResult> {
  if (!hasTauriBackend()) {
    return { status: 'unavailable' };
  }
  try {
    const { isEnabled } = await loadAutostartPlugin();
    return { status: 'ok', enabled: await isEnabled() };
  } catch {
    console.error(AUTOSTART_STATUS_FAILURE_MESSAGE);
    return { status: 'failure', message: AUTOSTART_STATUS_FAILURE_MESSAGE };
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<AutostartWriteResult> {
  if (!hasTauriBackend()) {
    console.error(AUTOSTART_UPDATE_FAILURE_MESSAGE);
    return { status: 'failure', message: AUTOSTART_UPDATE_FAILURE_MESSAGE };
  }
  try {
    const { enable, disable, isEnabled } = await loadAutostartPlugin();
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
    const actual = await isEnabled();
    if (actual !== enabled) {
      console.error(AUTOSTART_UPDATE_FAILURE_MESSAGE);
      return { status: 'failure', message: AUTOSTART_UPDATE_FAILURE_MESSAGE };
    }
    return { status: 'ok', enabled: actual };
  } catch {
    console.error(AUTOSTART_UPDATE_FAILURE_MESSAGE);
    return { status: 'failure', message: AUTOSTART_UPDATE_FAILURE_MESSAGE };
  }
}

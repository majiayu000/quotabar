import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSTART_STATUS_FAILURE_MESSAGE,
  AUTOSTART_UPDATE_FAILURE_MESSAGE,
  readAutostartEnabled,
  setAutostartEnabled,
} from '../src/services/autostart';

const autostartPlugin = vi.hoisted(() => ({
  enable: vi.fn(),
  disable: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-autostart', () => autostartPlugin);

function installDesktopBackend(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
}

beforeEach(() => {
  installDesktopBackend();
  autostartPlugin.enable.mockReset().mockResolvedValue(undefined);
  autostartPlugin.disable.mockReset().mockResolvedValue(undefined);
  autostartPlugin.isEnabled.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).window;
});

describe('autostart adapter', () => {
  it('reads the OS login item without writing local storage', async () => {
    autostartPlugin.isEnabled.mockResolvedValue(true);
    const setItem = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(), setItem },
    });

    await expect(readAutostartEnabled()).resolves.toEqual({ status: 'ok', enabled: true });
    expect(setItem).not.toHaveBeenCalled();
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('treats browser preview as unavailable without a status error', async () => {
    delete (globalThis as Record<string, unknown>).window;
    await expect(readAutostartEnabled()).resolves.toEqual({ status: 'unavailable' });
    expect(autostartPlugin.isEnabled).not.toHaveBeenCalled();
  });

  it('fails closed on status read errors without leaking the original exception', async () => {
    autostartPlugin.isEnabled.mockRejectedValue(new Error('launch-agent-token'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(readAutostartEnabled()).resolves.toEqual({
      status: 'failure',
      message: AUTOSTART_STATUS_FAILURE_MESSAGE,
    });
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(AUTOSTART_STATUS_FAILURE_MESSAGE);
  });

  it('enables only after the plugin re-read confirms the login item', async () => {
    autostartPlugin.isEnabled.mockResolvedValue(true);

    await expect(setAutostartEnabled(true)).resolves.toEqual({ status: 'ok', enabled: true });
    expect(autostartPlugin.enable).toHaveBeenCalledTimes(1);
    expect(autostartPlugin.disable).not.toHaveBeenCalled();
    expect(autostartPlugin.isEnabled).toHaveBeenCalledTimes(1);
  });

  it('fails closed when enable succeeds but the login item stays off', async () => {
    autostartPlugin.isEnabled.mockResolvedValue(false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(setAutostartEnabled(true)).resolves.toEqual({
      status: 'failure',
      message: AUTOSTART_UPDATE_FAILURE_MESSAGE,
    });
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(AUTOSTART_UPDATE_FAILURE_MESSAGE);
  });

  it('fails closed on plugin write errors in desktop and preview', async () => {
    autostartPlugin.enable.mockRejectedValue(new Error('permission-token'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(setAutostartEnabled(true)).resolves.toEqual({
      status: 'failure',
      message: AUTOSTART_UPDATE_FAILURE_MESSAGE,
    });

    delete (globalThis as Record<string, unknown>).window;
    await expect(setAutostartEnabled(true)).resolves.toEqual({
      status: 'failure',
      message: AUTOSTART_UPDATE_FAILURE_MESSAGE,
    });
    expect(autostartPlugin.enable).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls.flat()).toEqual([
      AUTOSTART_UPDATE_FAILURE_MESSAGE,
      AUTOSTART_UPDATE_FAILURE_MESSAGE,
    ]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { backend, normalizeTrayIpcPercentage } from '../src/services/backend';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauri.invoke,
}));

afterEach(() => {
  tauri.invoke.mockClear();
  vi.unstubAllGlobals();
});

describe('tray IPC percentage boundary', () => {
  it('preserves truthful over-limit usage inside the u8 range', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });

    await backend.updateTrayIcon('cursor', 130.4, true);

    expect(tauri.invoke).toHaveBeenCalledWith('update_tray_icon', {
      service: 'cursor',
      percentage: 130,
      visible: true,
      force: false,
      style: 'percent',
    });
  });

  it.each([
    [null, null],
    [-1, 0],
    [12.6, 13],
    [999, 255],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizeTrayIpcPercentage(input)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite usage %s',
    (input) => {
      expect(() => normalizeTrayIpcPercentage(input)).toThrow('Tray percentage must be finite');
    },
  );
});

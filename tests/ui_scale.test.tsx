import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UI_SCALE_KEY, UI_SCALE_ERROR, getSavedUiScale, useUiScale } from '../src/hooks/use_ui_scale';

const native = vi.hoisted(() => ({ setZoom: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => native }));
vi.mock('../src/services/backend', () => ({ hasTauriBackend: () => true }));
let renderer: ReactTestRenderer;
let state: ReturnType<typeof useUiScale>;
let store: Map<string, string>;
const events = new EventTarget();
const onError = vi.fn();
function Probe() { state = useUiScale(onError); return null; }
async function mount() { await act(async () => { renderer = create(createElement(Probe)); }); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal('window', events);
  native.setZoom.mockReset().mockResolvedValue(undefined);
  onError.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('interface size', () => {
  it('restores a saved size and follows the other window without writing it again', async () => {
    store.set(UI_SCALE_KEY, '1.25');
    await mount();
    expect(native.setZoom).toHaveBeenLastCalledWith(1.25);
    expect(state.scale).toBe(1.25);
    store.set(UI_SCALE_KEY, '1.5');
    await act(async () => {
      const event = new Event('storage');
      Object.assign(event, { key: UI_SCALE_KEY });
      events.dispatchEvent(event);
    });
    expect(state.scale).toBe(1.5);
    expect(native.setZoom).toHaveBeenLastCalledWith(1.5);
  });
  it('persists a successful change only after native zoom succeeds', async () => {
    await mount();
    let resolve!: () => void;
    native.setZoom.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    let change!: Promise<void>;
    await act(async () => { change = state.changeScale(1.5); });
    expect(state.busy).toBe(true);
    expect(state.scale).toBe(1);
    expect(store.has(UI_SCALE_KEY)).toBe(false);
    await act(async () => { resolve(); await change; });
    expect(state.scale).toBe(1.5);
    expect(store.get(UI_SCALE_KEY)).toBe('1.5');
    expect(state.busy).toBe(false);
  });
  it('keeps the old size and preference and reports a native failure', async () => {
    store.set(UI_SCALE_KEY, '1.25');
    await mount();
    native.setZoom.mockRejectedValueOnce(new Error('native failure'));
    await act(async () => { await state.changeScale(1.5); });
    expect(state.scale).toBe(1.25);
    expect(store.get(UI_SCALE_KEY)).toBe('1.25');
    expect(onError).toHaveBeenCalledWith(UI_SCALE_ERROR);
    expect(state.busy).toBe(false);
  });
  it('does not persist a stale change after a newer cross-window preference', async () => {
    await mount();
    let resolve!: () => void;
    native.setZoom.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    let change!: Promise<void>;
    await act(async () => { change = state.changeScale(1.25); });
    store.set(UI_SCALE_KEY, '1.5');
    await act(async () => {
      const event = new Event('storage'); Object.assign(event, { key: UI_SCALE_KEY }); events.dispatchEvent(event);
    });
    await act(async () => { resolve(); await change; });
    expect(state.scale).toBe(1.5);
    expect(store.get(UI_SCALE_KEY)).toBe('1.5');
  });
  it('uses 100% for a missing or invalid preference', () => {
    expect(getSavedUiScale()).toBe(1);
    store.set(UI_SCALE_KEY, '9');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getSavedUiScale()).toBe(1);
    log.mockRestore();
  });
});

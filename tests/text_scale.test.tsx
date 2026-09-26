import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '../src/components/SettingsView';
import { setLanguagePreference } from '../src/i18n';
import { subscribeStorageReadFailures, subscribeStorageWriteFailures } from '../src/services/storage';
import { getSavedTextScale, saveTextScale, TEXT_SCALE_STORAGE_KEY } from '../src/services/text_scale';

vi.mock('../src/services/autostart', () => ({
  readAutostartEnabled: async () => ({ status: 'ok', enabled: false }),
  setAutostartEnabled: async () => ({ status: 'ok', enabled: false }),
}));

let store: Map<string, string>;
let renderer: ReactTestRenderer | undefined;
const stops: (() => void)[] = [];

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  // Clear any in-session fallback left by the failed-write scenario.
  saveTextScale(1);
  store.delete(TEXT_SCALE_STORAGE_KEY);
  setLanguagePreference('en');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  stops.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('text size persistence', () => {
  it('preserves the current size when no preference exists', () => {
    expect(getSavedTextScale()).toBe(1);
  });

  it.each([1, 1.15, 1.3] as const)('restores the saved %s scale', (scale) => {
    expect(saveTextScale(scale)).toBe(true);
    expect(getSavedTextScale()).toBe(scale);
  });

  it.each(['null', '0', '-1', '2', '"1.3"', '{}', 'broken'])('reports invalid saved value %s', (value) => {
    const failure = vi.fn();
    stops.push(subscribeStorageReadFailures(failure));
    store.set(TEXT_SCALE_STORAGE_KEY, value);
    expect(getSavedTextScale()).toBe(1);
    expect(failure).toHaveBeenCalledOnce();
  });

  it('reports unreadable storage and uses the default', () => {
    const failure = vi.fn();
    stops.push(subscribeStorageReadFailures(failure));
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(getSavedTextScale()).toBe(1);
    expect(failure).toHaveBeenCalledOnce();
  });

  it('keeps a failed write for this session and reports that it was not saved', () => {
    const failure = vi.fn();
    stops.push(subscribeStorageWriteFailures(failure));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(saveTextScale(1.3)).toBe(false);
    expect(failure).toHaveBeenCalledOnce();
    expect(store.has(TEXT_SCALE_STORAGE_KEY)).toBe(false);
    expect(getSavedTextScale()).toBe(1.3);
  });
});

describe('text size settings', () => {
  it.each([false, true])('offers and applies text size in workspace=%s', async (workspace) => {
    const onTextScaleChange = vi.fn();
    await act(async () => {
      renderer = create(createElement(SettingsView, {
        workspace, textScale: 1.15, onTextScaleChange,
        isMacOS: false, theme: 'light', dockHidden: false, trayEntries: [],
        panelSections: { timeline: true, cost: true, trend: true, tips: true },
        trayStyle: 'percent', trayCycle: false, events: [],
        notificationSettings: { q80: true, q95: true, q100: true, bonusReady: true, bonus: false },
        switcherVisibility: { claude: true, codex: true, cursor: true, grok: true, antigravity: true },
        onClose: vi.fn(), onThemeChange: vi.fn(), onDockToggle: vi.fn(),
        onTrayToggle: vi.fn(), onPanelSectionToggle: vi.fn(), onTrayStyleChange: vi.fn(),
        onTrayCycleToggle: vi.fn(), onNotificationToggle: vi.fn(), onSwitcherToggle: vi.fn(),
        onApplyPreset: vi.fn(), onSelectEventProvider: vi.fn(),
      }));
    });
    const select = renderer!.root.findByProps({ 'aria-label': 'Text size' });
    expect(select.props.value).toBe(1.15);
    expect(select.findAllByType('option').map((option) => option.props.value)).toEqual([1, 1.15, 1.3]);
    await act(async () => select.props.onChange({ target: { value: '1.3' } }));
    expect(onTextScaleChange).toHaveBeenCalledWith(1.3);
    await act(async () => select.props.onChange({ target: { value: '99' } }));
    expect(onTextScaleChange).toHaveBeenCalledOnce();
  });
});

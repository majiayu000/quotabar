import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '../src/components/SettingsView';
import {
  AUTOSTART_STATUS_FAILURE_MESSAGE,
  AUTOSTART_UPDATE_FAILURE_MESSAGE,
} from '../src/services/autostart';
import type { TrayToggleEntry } from '../src/components/TrayToggles';

const autostart = vi.hoisted(() => ({
  readAutostartEnabled: vi.fn(),
  setAutostartEnabled: vi.fn(),
}));

vi.mock('../src/services/autostart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/autostart')>();
  return {
    ...actual,
    readAutostartEnabled: autostart.readAutostartEnabled,
    setAutostartEnabled: autostart.setAutostartEnabled,
  };
});

const trayEntries: TrayToggleEntry[] = [
  { service: 'claude', label: 'Claude Tray', enabled: true, canDisable: true, connected: true, connectedHint: 'Ready', disconnectedHint: 'Sign in' },
];

function settingsProps(overrides: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  return {
    isMacOS: true,
    theme: 'light' as const,
    dockHidden: false,
    trayEntries,
    panelSections: { timeline: true, cost: true, trend: true, tips: true },
    trayStyle: 'percent' as const,
    trayCycle: false,
    events: [],
    notificationSettings: { q80: true, q95: true, q100: true, bonusReady: true, bonus: false },
    switcherVisibility: { claude: true, codex: true, cursor: true, grok: true, antigravity: true },
    onClose: () => {},
    onThemeChange: () => {},
    onDockToggle: () => {},
    onTrayToggle: () => {},
    onPanelSectionToggle: () => {},
    onTrayStyleChange: () => {},
    onTrayCycleToggle: () => {},
    onNotificationToggle: () => {},
    onSwitcherToggle: () => {},
    onApplyPreset: () => {},
    onSelectEventProvider: () => {},
    ...overrides,
  };
}

function launchSwitch(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ 'aria-label': 'Launch at Login' });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  autostart.readAutostartEnabled.mockReset().mockResolvedValue({ status: 'ok', enabled: false });
  autostart.setAutostartEnabled.mockReset().mockResolvedValue({ status: 'ok', enabled: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Launch at Login settings row', () => {
  it('reflects an existing OS login item after load', async () => {
    autostart.readAutostartEnabled.mockResolvedValue({ status: 'ok', enabled: true });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SettingsView, settingsProps()));
      await Promise.resolve();
    });

    expect(launchSwitch(renderer).props['aria-checked']).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('keeps the switch off and shows copy when status cannot be read', async () => {
    autostart.readAutostartEnabled.mockResolvedValue({
      status: 'failure',
      message: AUTOSTART_STATUS_FAILURE_MESSAGE,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SettingsView, settingsProps()));
      await Promise.resolve();
    });

    expect(launchSwitch(renderer).props['aria-checked']).toBe(false);
    expect(renderer.root.findByProps({ role: 'alert' }).props.children).toBe(
      AUTOSTART_STATUS_FAILURE_MESSAGE,
    );
    await act(async () => renderer.unmount());
  });

  it('does not flip the switch when registration fails', async () => {
    const onAutostartNotice = vi.fn();
    autostart.setAutostartEnabled.mockResolvedValue({
      status: 'failure',
      message: AUTOSTART_UPDATE_FAILURE_MESSAGE,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SettingsView, settingsProps({ onAutostartNotice })));
      await Promise.resolve();
    });

    await act(async () => {
      launchSwitch(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(launchSwitch(renderer).props['aria-checked']).toBe(false);
    expect(onAutostartNotice).toHaveBeenCalledExactlyOnceWith(AUTOSTART_UPDATE_FAILURE_MESSAGE);
    expect(renderer.root.findByProps({ role: 'alert' }).props.children).toBe(
      AUTOSTART_UPDATE_FAILURE_MESSAGE,
    );
    await act(async () => renderer.unmount());
  });

  it('turns on after a confirmed login-item write', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SettingsView, settingsProps()));
      await Promise.resolve();
    });

    await act(async () => {
      launchSwitch(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(autostart.setAutostartEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(launchSwitch(renderer).props['aria-checked']).toBe(true);
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});

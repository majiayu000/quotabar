import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import SettingsView from '../src/components/SettingsView';
import type { TrayToggleEntry } from '../src/components/TrayToggles';

const trayEntries: TrayToggleEntry[] = [
  { service: 'claude', label: 'Claude Tray', enabled: true, canDisable: true, connected: true },
  { service: 'codex', label: 'Codex Tray', enabled: true, canDisable: true, connected: true },
  { service: 'cursor', label: 'Cursor Tray', enabled: true, canDisable: true, connected: false },
  { service: 'grok', label: 'Grok Tray', enabled: true, canDisable: true, connected: false },
  { service: 'antigravity', label: 'Antigravity Tray', enabled: false, canDisable: true, connected: false },
];

function settingsProps() {
  return {
    isMacOS: true,
    theme: 'light' as const,
    dockHidden: true,
    trayEntries,
    panelSections: { timeline: true, cost: true, trend: true, tips: true },
    trayStyle: 'percent' as const,
    trayCycle: false,
    events: [
      { id: '1', time: '2026-09-03T10:00:00Z', level: 'critical' as const, text: 'Codex usage crossed 95%' },
      { id: '2', time: '2026-09-03T10:00:00Z', level: 'critical' as const, text: 'Failed to persist local setting.' },
    ],
    notificationSettings: {
      q80: true,
      q95: true,
      q100: true,
      bonusReady: true,
      bonus: true,
    },
    switcherVisibility: {
      claude: true,
      codex: true,
      cursor: true,
      grok: true,
      antigravity: true,
    },
    onClose: () => {},
    onThemeChange: () => {},
    onDockToggle: () => {},
    onTrayToggle: () => {},
    onPanelSectionToggle: () => {},
    onTrayStyleChange: () => {},
    onTrayCycleToggle: () => {},
    onNotificationToggle: () => {},
    onSwitcherToggle: () => {},
    onApplyPreset: vi.fn(),
    onSelectEventProvider: vi.fn(),
  };
}

describe('settings event navigation', () => {
  it('makes labeled events clickable and leaves unlabeled events read-only', () => {
    const html = renderToStaticMarkup(createElement(SettingsView, settingsProps()));

    expect(html).toContain('event-text event-text-link');
    expect(html).toContain('Codex usage crossed 95%');
    expect(html).toContain('Failed to persist local setting.');
    expect((html.match(/event-text-link/g) ?? [])).toHaveLength(1);
    expect(html).toContain('>Limits<');
    expect(html).toContain('>Alerts<');
    expect(html).toContain('>All<');
    expect(html).toContain('>Codex<');
  });
});

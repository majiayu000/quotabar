import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ActionButtons from '../src/components/ActionButtons';
import CostSummarySection from '../src/components/CostSummarySection';
import SettingsView from '../src/components/SettingsView';
import TabSwitcher from '../src/components/TabSwitcher';
import { backend } from '../src/services/backend';
import type { ProviderSummary } from '../src/services/provider_summary';
import type { TrayToggleEntry } from '../src/components/TrayToggles';

const summaries: ProviderSummary[] = [
  { id: 'claude', label: 'Claude', shortLabel: 'Claude', initials: 'C', accent: '#d97757', connected: true, loading: false, usedPercent: 48, statusText: '48% used' },
  { id: 'codex', label: 'Codex', shortLabel: 'Codex', initials: 'Co', accent: '#10a37f', connected: false, loading: false, usedPercent: null, statusText: 'Offline' },
];

const trayEntries: TrayToggleEntry[] = [
  { service: 'claude', label: 'Claude Tray', enabled: true, canDisable: true, connected: true, connectedHint: 'Ready', disconnectedHint: 'Sign in' },
  { service: 'codex', label: 'Codex Tray', enabled: true, canDisable: true, connected: false, disconnectedHint: 'Sign in' },
  { service: 'cursor', label: 'Cursor Tray', enabled: false, canDisable: true, connected: false, disconnectedHint: 'Sign in' },
  { service: 'antigravity', label: 'Antigravity Tray', enabled: false, canDisable: true, connected: false, disconnectedHint: 'Preview' },
];

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const values = new Map<string, string>();
  values.set('claude-quota-monthly-budgets', JSON.stringify({ claude: 100 }));
  (globalThis as Record<string, unknown>).localStorage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('panel shell UI', () => {
  it('shows recognizable provider labels as native navigation buttons', () => {
    const html = renderToStaticMarkup(
      <TabSwitcher activeTab="claude" summaries={summaries} onTabChange={() => {}} />,
    );

    expect(html).toContain('<nav');
    expect(html).toContain('aria-label="Provider views"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('tabindex="-1"');
    expect(html).toContain('provider-card-label">Claude');
    expect(html).toContain('provider-card-label">Codex');
    expect(html).toContain('48%');
  });

  it('hides the provider dashboard action and keeps passive timestamps quiet', () => {
    const html = renderToStaticMarkup(
      <ActionButtons
        onRefresh={() => {}}
        onDashboard={() => {}}
        onSettings={() => {}}
        onQuit={() => {}}
        loading={false}
        statusText="Updated now"
        showDashboard={false}
      />,
    );

    expect(html).not.toContain('Dashboard');
    expect(html).not.toContain('role="status"');
    expect(html).toContain('aria-live="off"');
    expect(html).toContain('Updated now');
  });

  it('announces refresh loading without guessing its outcome', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(ActionButtons, {
        onRefresh: vi.fn(),
        onDashboard: vi.fn(),
        onSettings: vi.fn(),
        onQuit: vi.fn(),
        loading: true,
        statusText: 'Updating...',
      }));
    });

    expect(renderer.root.findByProps({ role: 'status' }).children).toContain('Updating quota data');
    await act(async () => {
      renderer.update(createElement(ActionButtons, {
        onRefresh: vi.fn(),
        onDashboard: vi.fn(),
        onSettings: vi.fn(),
        onQuit: vi.fn(),
        loading: false,
        statusText: 'Updated now',
      }));
    });
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0);
    expect(renderer.root.findByProps({ className: 'action-status' }).props['aria-live']).toBe('off');
    await act(async () => renderer.unmount());
  });

  it('groups settings by task and combines panel and menu visibility', () => {
    const html = renderToStaticMarkup(
      <SettingsView
        isMacOS
        theme="light"
        dockHidden
        trayEntries={trayEntries}
        panelSections={{ timeline: true, cost: true, trend: true, tips: false }}
        trayStyle="percent"
        trayCycle={false}
        events={[]}
        notificationSettings={{
          q80: true,
          q95: true,
          q100: true,
          bonusReady: true,
          bonus: false,
        }}
        switcherVisibility={{ claude: true, codex: true, cursor: true, grok: true, antigravity: true }}
        onClose={() => {}}
        onThemeChange={() => {}}
        onDockToggle={() => {}}
        onTrayToggle={() => {}}
        onPanelSectionToggle={() => {}}
        onTrayStyleChange={() => {}}
        onTrayCycleToggle={() => {}}
        onNotificationToggle={() => {}}
        onSwitcherToggle={() => {}}
        onApplyPreset={() => {}}
        onSelectEventProvider={() => {}}
      />,
    );

    expect((html.match(/class="settings-group"/g) ?? [])).toHaveLength(6);
    expect(html).toContain('>Limits<');
    expect(html).toContain('>Alerts<');
    expect(html).toContain('Alert at 100% used');
    expect(html).toContain('Alert when a bonus reset is unused at 100%');
    expect(html).toContain('>Providers<');
    expect(html).toContain('>Panel<');
    expect(html).toContain('>Menu<');
    expect(html).toContain('aria-label="Show Claude in panel"');
    expect(html).toContain('aria-label="Show Claude in menu bar"');
    expect(html).toContain('theme-option-label">Light');
    expect(html).toContain('>Ready<');
    expect(html).toContain('>Sign in<');
    expect(html).toContain('>Preview<');
    expect(html).toContain('>Launch at Login<');
    expect(html).toContain('aria-label="Launch at Login"');
  });

  it('keeps compact settings controls visually self-contained at panel width', () => {
    const css = readFileSync(new URL('../src/redesign-settings.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.settings-group \.settings-line \{[^}]*display: flex;/s);
    expect(css).toMatch(/\.settings-group \.settings-hint\[role="alert"\] \{[^}]*color: var\(--color-critical\);/s);
    expect(css).toMatch(/\.settings-group \.target-switch \{[^}]*background: var\(--track\);/s);
    expect(css).toMatch(/\.settings-group \.target-switch span \{[^}]*border-radius: 50%;/s);
    expect(css).toMatch(/\.settings-group \.target-switch\.on \{[^}]*background: #34c759;/s);
    expect(css).toMatch(/\.settings-group \.settings-seg \{[^}]*display: flex;/s);
    expect(css).toMatch(/\.settings-group \.budget-input \{[^}]*width: 64px;/s);
    expect(css).toMatch(/\.settings-group \.event-row \{[^}]*display: flex;/s);
  });

  it('labels local cost as an estimate and makes the daily trend keyboard accessible', async () => {
    vi.spyOn(backend, 'getCostOverview').mockResolvedValue({
      source: 'claude',
      displayName: 'Claude',
      currency: 'USD',
      generatedAt: '2026-08-24T08:00:00Z',
      cached: false,
      ranges: [{
        range: 'today',
        label: 'Today',
        currency: 'USD',
        cost: 12,
        costUsd: 12,
        tokens: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 30 },
        models: [],
        validEntries: 1,
        skippedEntries: 0,
        elapsedMs: 1,
      }, {
        range: 'month',
        label: 'Month',
        currency: 'USD',
        cost: 25,
        costUsd: 25,
        tokens: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 30 },
        models: [],
        validEntries: 1,
        skippedEntries: 0,
        elapsedMs: 1,
      }],
    });
    vi.spyOn(backend, 'getCostDaily').mockResolvedValue({
      source: 'claude',
      currency: 'USD',
      generatedAt: '2026-08-24T08:00:00Z',
      cached: false,
      days: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, '0')}`,
        cost: index + 1,
        costUsd: index + 1,
        totalTokens: 30,
      })),
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CostSummarySection, { source: 'claude', autoRefreshIntervalMs: 0 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('API-equivalent usage');
    expect(text).toContain('Local estimate');
    const trendButtons = renderer.root.findAll((node) => (
      node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('spark-bar-hit')
    ));
    expect(trendButtons).toHaveLength(0);
    const thirtyDayButton = renderer.root.findAllByType('button').find((node) => (
      typeof node.props.className === 'string'
      && node.props.className.includes('spark-chip')
      && node.children.includes('30D')
    ));
    expect(thirtyDayButton).toBeDefined();
    await act(async () => thirtyDayButton?.props.onClick());
    let trend = renderer.root.findByProps({ role: 'slider' });
    expect(trend.props.tabIndex).toBe(0);
    expect(trend.props['aria-valuemax']).toBe(30);
    await act(async () => trend.props.onFocus());
    trend = renderer.root.findByProps({ role: 'slider' });
    await act(async () => trend.props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() }));
    trend = renderer.root.findByProps({ role: 'slider' });
    expect(trend.props['aria-valuenow']).toBe(29);
    expect(trend.props['aria-valuetext']).toContain('2026-08-29');
    const tenthBar = renderer.root.findAll((node) => (
      node.type === 'span'
      && typeof node.props.className === 'string'
      && node.props.className.includes('spark-bar-hit')
    ))[9];
    await act(async () => tenthBar.props.onMouseEnter());
    trend = renderer.root.findByProps({ role: 'slider' });
    expect(trend.props['aria-valuenow']).toBe(10);
    expect(trend.props['aria-valuetext']).toContain('2026-08-10');
    await act(async () => trend.props.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() }));
    trend = renderer.root.findByProps({ role: 'slider' });
    expect(trend.props['aria-valuenow']).toBe(28);
    await act(async () => trend.props.onMouseLeave());
    trend = renderer.root.findByProps({ role: 'slider' });
    expect(trend.props['aria-valuenow']).toBe(28);
    await act(async () => trend.props.onKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() }));
    trend = renderer.root.findByProps({ role: 'slider' });
    expect(trend.props['aria-valuenow']).toBe(29);
    await act(async () => trend.props.onKeyDown({ key: 'Home', preventDefault: vi.fn() }));
    expect(renderer.root.findByProps({ role: 'slider' }).props['aria-valuenow']).toBe(1);
    trend = renderer.root.findByProps({ role: 'slider' });
    await act(async () => trend.props.onKeyDown({ key: 'End', preventDefault: vi.fn() }));
    expect(renderer.root.findByProps({ role: 'slider' }).props['aria-valuenow']).toBe(30);
    expect(renderer.root.findAllByProps({ role: 'progressbar' })).toHaveLength(1);
    await act(async () => renderer.unmount());
  });
});

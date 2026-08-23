import { createElement } from 'react';
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
  { service: 'claude', label: 'Claude Tray', enabled: true, canDisable: true, connected: true, disconnectedHint: 'Sign in' },
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
  it('shows recognizable provider labels and tab semantics', () => {
    const html = renderToStaticMarkup(
      <TabSwitcher activeTab="claude" summaries={summaries} onTabChange={() => {}} />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('provider-card-label">Claude');
    expect(html).toContain('provider-card-label">Codex');
    expect(html).toContain('48%');
  });

  it('hides the provider dashboard action on Overview and announces refresh status', () => {
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
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Updated now');
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
        notificationSettings={{ q80: true, q95: true, bonus: false }}
        switcherVisibility={{ claude: true, codex: true, cursor: true, antigravity: true }}
        onClose={() => {}}
        onThemeChange={() => {}}
        onDockToggle={() => {}}
        onTrayToggle={() => {}}
        onPanelSectionToggle={() => {}}
        onTrayStyleChange={() => {}}
        onTrayCycleToggle={() => {}}
        onNotificationToggle={() => {}}
        onSwitcherToggle={() => {}}
      />,
    );

    expect((html.match(/class="settings-group"/g) ?? [])).toHaveLength(5);
    expect(html).toContain('>Providers<');
    expect(html).toContain('>Panel<');
    expect(html).toContain('>Menu<');
    expect(html).toContain('aria-label="Show Claude in panel"');
    expect(html).toContain('aria-label="Show Claude in menu bar"');
    expect(html).toContain('theme-option-label">Light');
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
      days: [{ date: '2026-08-24', cost: 12, costUsd: 12, totalTokens: 30 }],
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
    expect(trendButtons).toHaveLength(1);
    expect(renderer.root.findAllByProps({ role: 'progressbar' })).toHaveLength(1);
    await act(async () => renderer.unmount());
  });
});

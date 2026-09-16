import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TabSwitcher from '../src/components/TabSwitcher';
import { getSavedProviderFavorites, saveProviderFavorites } from '../src/services/provider_favorites';
import { SERVICES, SERVICE_META } from '../src/services/service_meta';
import type { ProviderSummary } from '../src/services/provider_summary';

const summaries: ProviderSummary[] = SERVICES.map((id) => ({ id, label: SERVICE_META[id].label, shortLabel: SERVICE_META[id].label, initials: id[0], accent: '', connected: true, loading: false, usedPercent: 25, statusText: 'Connected' }));
let renderer: ReactTestRenderer | undefined;
let values: Map<string, string>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  saveProviderFavorites([]); // Also clears any storage failure shadow from this test.
  vi.unstubAllGlobals();
});
const byLabel = (label: string) => renderer!.root.findByProps({ 'aria-label': label });
const navButtons = () => renderer!.root.findByType('nav').findAllByType('button');
async function mount(activeTab: 'all' | 'grok' = 'all') {
  const onTabChange = vi.fn();
  await act(async () => { renderer = create(<TabSwitcher summaries={summaries} activeTab={activeTab} onTabChange={onTabChange} />); });
  return onTabChange;
}
async function open() { await act(async () => byLabel(`All services (${summaries.length})`).props.onClick()); }

it('bounds navigation and highlights All when the current service is not a favorite', async () => {
  await mount('grok');
  expect(navButtons()).toHaveLength(5);
  expect(byLabel(`All services (${summaries.length})`).props['aria-current']).toBe('page');
  await open();
  expect(renderer!.root.findAllByProps({ className: 'provider-picker-row' })).toHaveLength(summaries.length);
});

it('searches case-insensitively, reports no matches, and selects a non-favorite', async () => {
  const change = await mount(); await open();
  await act(async () => byLabel('Search services').props.onChange({ target: { value: ' GROK ' } }));
  const rows = renderer!.root.findAllByProps({ className: 'provider-picker-row' });
  expect(rows).toHaveLength(1);
  await act(async () => rows[0].findByProps({ className: 'provider-picker-select' }).props.onClick());
  expect(change).toHaveBeenCalledWith('grok');
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(0);
  await open();
  await act(async () => byLabel('Search services').props.onChange({ target: { value: 'no-match' } }));
  expect(renderer!.root.findByProps({ className: 'provider-picker-empty' }).children).toEqual(['No matching services']);
});

it('requires replacing a favorite at the limit and persists the chosen order', async () => {
  await mount(); await open();
  await act(async () => byLabel('Favorite Grok').props.onClick());
  expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('Remove a favorite first');
  await act(async () => byLabel('Remove favorite Claude').props.onClick());
  await act(async () => byLabel('Favorite Grok').props.onClick());
  expect(getSavedProviderFavorites()).toEqual(['codex', 'cursor', 'grok']);
  expect(navButtons().filter((button) => button.props['data-provider']).map((button) => button.props['data-provider'])).toEqual(['all', 'codex', 'cursor', 'grok']);
});

it('preserves an intentionally empty favorite list and excludes hidden providers', async () => {
  saveProviderFavorites([]); await mount();
  expect(navButtons()).toHaveLength(2);
  await act(async () => renderer!.update(<TabSwitcher summaries={summaries.filter((summary) => summary.id !== 'grok')} activeTab="all" onTabChange={vi.fn()} />));
  await act(async () => byLabel('All services (4)').props.onClick());
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Favorite Grok' })).toHaveLength(0);
});

it('reports invalid stored preferences and failed writes without losing the current choice', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  values.set('quotabar-provider-favorites', '["unknown"]');
  expect(getSavedProviderFavorites()).toBeNull();
  values.set('quotabar-provider-favorites', '[]');
  await mount(); await open();
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('disk unavailable'); });
  await act(async () => byLabel('Favorite Codex').props.onClick());
  expect(navButtons()).toHaveLength(3);
  expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('could not be saved');
  expect(getSavedProviderFavorites()).toEqual(['codex']);
});

it('keeps thirty providers in the searchable list while the top bar stays at five buttons', async () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ ...summaries[0], id: `demo-${index}` as ProviderSummary['id'], label: `Demo Agent ${index + 1}`, shortLabel: `Agent ${index + 1}` }));
  await act(async () => { renderer = create(<TabSwitcher summaries={many} activeTab="all" onTabChange={vi.fn()} />); });
  expect(navButtons()).toHaveLength(5);
  await act(async () => byLabel('All services (30)').props.onClick());
  expect(renderer!.root.findAllByProps({ className: 'provider-picker-row' })).toHaveLength(30);
  await act(async () => byLabel('Search services').props.onChange({ target: { value: 'Agent 30' } }));
  expect(renderer!.root.findAllByProps({ className: 'provider-picker-row' })).toHaveLength(1);
});

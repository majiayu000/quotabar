import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuotaCard from '../src/components/QuotaCard';
import QuotaOverview from '../src/components/QuotaOverview';
import SettingsView from '../src/components/SettingsView';
import App from '../src/App';
import { backend } from '../src/services/backend';
import { DEFAULT_QUOTA_DISPLAY, getSavedQuotaDisplay, saveQuotaDisplay } from '../src/services/quota_display';
import type { ProviderSummary, QuotaWindowSummary } from '../src/services/provider_summary';

vi.mock('../src/hooks/use_popover_window', () => ({ usePopoverWindow: () => false }));

const claude: ProviderSummary = {
  id: 'claude', label: 'Claude', shortLabel: 'Claude', initials: 'C', accent: '#d97757',
  connected: true, loading: false, usedPercent: 73, statusText: '73% used',
};
const windows: QuotaWindowSummary[] = [
  { provider: 'claude', providerLabel: 'Claude', label: '5-hour usage', usedPercent: 73, resetAtMs: Date.parse('2026-09-15T01:00:00Z') },
  { provider: 'claude', providerLabel: 'Claude', label: '7-day usage', usedPercent: 7 },
];
const overviewProps = () => ({
  summaries: [claude], windows, display: DEFAULT_QUOTA_DISPLAY,
  onProviderSelect: vi.fn(), onRefresh: vi.fn(), onSettings: vi.fn(),
});
let renderer: ReactTestRenderer | undefined;
let values: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compact quota overview', () => {
  it('uses remaining quota consistently across the headline, ring and bars', () => {
    const html = renderToStaticMarkup(<QuotaOverview {...overviewProps()} />);
    expect(html).toContain('<strong>27%</strong>');
    expect(html).toContain('stroke-dasharray="27 100"');
    expect(html).toContain('aria-valuenow="27"');
    expect(html).toContain('aria-valuenow="93"');
    expect(html).toContain('width:27%');
    expect(html).toContain('Remaining quota');
    expect(html).not.toContain('73%');
  });

  it('keeps low remaining quota critical across the headline, ring and bars', () => {
    const html = renderToStaticMarkup(<QuotaOverview {...overviewProps()} windows={[{ ...windows[0], usedPercent: 96 }]} display={{ weekly: true }} />);
    expect(html).toContain('<strong>4%</strong>');
    expect(html).toContain('stroke-dasharray="4 100"');
    expect(html).toContain('aria-valuenow="4"');
    expect(html).toContain('width:4%');
    expect(html).toContain('var(--quota-critical, #FF3B30)');
    expect(html).toContain('Remaining quota');
  });

  it('hides weekly detail without hiding a more constrained weekly headline', () => {
    const html = renderToStaticMarkup(<QuotaOverview {...overviewProps()} windows={[windows[0], { ...windows[1], usedPercent: 98 }]} display={{ weekly: false }} />);
    expect(html).toContain('<strong>2%</strong>');
    expect(html).toContain('7-day usage · Closest to limit');
    expect((html.match(/role="progressbar"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('aria-valuenow="27"');
  });

  it.each([null, NaN, Infinity])('does not turn missing or invalid usage (%s) into zero', (usedPercent) => {
    const html = renderToStaticMarkup(<QuotaOverview {...overviewProps()} summaries={[{ ...claude, usedPercent }]} windows={[]} />);
    expect(html).toContain('<strong>—</strong>');
    expect(html).toContain('No quota data');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('quota-dial-fill');
  });

  it('keeps stale data dated and the recovery action available', async () => {
    const props = overviewProps();
    await act(async () => { renderer = create(<QuotaOverview {...props} summaries={[{
      ...claude, failed: true, lastSuccessAt: Date.parse('2026-09-14T12:00:00Z'),
      readState: { error: 'HTTP 429', readAt: Date.parse('2026-09-14T12:00:00Z') },
    }]} />); });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('Showing stale data');
    expect(text).toContain('Last successful read');
    expect(text).toContain('last known data');
    const action = renderer!.root.findAllByType('button').find((button) => button.children.includes('View cause and recovery steps ›'))!;
    await act(async () => action.props.onClick());
    expect(props.onProviderSelect).toHaveBeenCalledExactlyOnceWith('claude');
  });

  it('shows an empty ring when exhausted and keeps the full ring at zero used', () => {
    const exhausted = renderToStaticMarkup(<QuotaOverview {...overviewProps()} windows={[{ ...windows[0], usedPercent: 100 }]} />);
    expect(exhausted).toContain('<strong>0%</strong>');
    expect(exhausted).not.toContain('quota-dial-fill');
    const unused = renderToStaticMarkup(<QuotaOverview {...overviewProps()} windows={[{ ...windows[0], usedPercent: 0 }]} />);
    expect(unused).toContain('<strong>100%</strong>');
    expect(unused).toContain('stroke-dasharray="100 100"');
  });
});

describe('quota display preferences', () => {
  it('round-trips display settings and reports malformed saved data', () => {
    expect(getSavedQuotaDisplay()).toEqual(DEFAULT_QUOTA_DISPLAY);
    expect(saveQuotaDisplay({ weekly: false })).toBe(true);
    expect(getSavedQuotaDisplay()).toEqual({ weekly: false });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    values.set('quotabar-quota-display', '{"weekly":"invalid"}');
    expect(getSavedQuotaDisplay()).toEqual(DEFAULT_QUOTA_DISPLAY);
    expect(error).toHaveBeenCalled();
  });

  it('persists settings through real controls and isolates reminders from Display', async () => {
    vi.spyOn(backend, 'getQuota').mockResolvedValue({ connected: true, session: { used: 73, limit: 100, percentage: 73 } });
    vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: false });
    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({ connected: false });
    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({ connected: false, availableCount: 0, credits: [] });
    vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({ connected: false });
    vi.spyOn(backend, 'getGrokInfo').mockResolvedValue({ connected: false });
    vi.spyOn(backend, 'getAntigravityInfo').mockResolvedValue({ connected: false });
    vi.spyOn(backend, 'getDockVisibility').mockResolvedValue(true);
    vi.spyOn(backend, 'setDockVisibility').mockResolvedValue();
    vi.spyOn(backend, 'updateTrayIcon').mockResolvedValue();
    await act(async () => { renderer = create(createElement(App)); });
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Open settings' }).props.onClick());
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'settings-alerts-title' }).props.hidden).toBe(true);
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Quota display mode' })).toHaveLength(0);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Show weekly quota details' }).props.onClick());
    expect(getSavedQuotaDisplay()).toEqual({ weekly: false });
    const categories = renderer!.root.findByProps({ 'aria-label': 'Settings categories' });
    await act(async () => categories.findAllByType('button')[1].props.onClick());
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'settings-alerts-title' }).props.hidden).toBe(false);
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'settings-appearance-title' }).props.hidden).toBe(true);
    const reminder = renderer!.root.findByProps({ 'aria-label': 'Alert at 20% remaining' });
    await act(async () => reminder.props.onClick());
    expect(JSON.parse(values.get('claude-quota-notifications')!).q80).toBe(false);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Back to provider view' }).props.onClick());
    expect(renderer!.root.findByType(QuotaOverview).props.display).toEqual({ weekly: false });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Remaining quota');
    await act(async () => renderer!.root.findByType(QuotaOverview).props.onSettings());
    expect(renderer!.root.findByType(SettingsView).props.initialPage).toBe('accounts');
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'settings-providers-title' }).props.hidden).toBe(false);
  });
});

it('keeps the overview focused on quota readings without cost or bonus sections', () => {
  const html = renderToStaticMarkup(createElement(QuotaOverview, { ...overviewProps(), windows: [{ ...windows[0], usedPercent: 100 }] }));
  expect(html.slice(html.indexOf('<header'), html.indexOf('</header>'))).not.toContain('<strong>');
  expect(html).toContain('<strong>0%</strong>');
  expect(html).not.toContain('API-equivalent');
  expect(html).not.toContain('Bonus resets');
  expect(html).toContain('View Claude details');
});


it.each([0, 25, 79, 80, 94, 95, 100, 130])('uses the same severity color in overview and details at %s percent', (used) => {
  const overview = renderToStaticMarkup(createElement(QuotaOverview, { ...overviewProps(), windows: [{ ...windows[0], usedPercent: used }] }));
  const detail = renderToStaticMarkup(createElement(QuotaCard, { label: '5-hour quota', percentage: used, resetsIn: '1h' }));
  const severity = used >= 95 ? 'critical' : used >= 80 ? 'warning' : 'good';
  for (const html of [overview, detail]) {
    expect(html).toContain(`background:var(--quota-${severity},`);
    expect(html).not.toContain('linear-gradient');
    expect(html).toContain(`aria-valuenow="${Math.max(0, 100 - used)}"`);
    expect(html).toContain(`width:${Math.max(0, 100 - used)}%`);
  }
});

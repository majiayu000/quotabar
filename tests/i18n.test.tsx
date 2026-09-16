import { notify } from '../src/services/notifications';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../src/i18n/messages';
import {
  getLocale, getLanguagePreference, initializeI18n, LANGUAGE_STORAGE_KEY,
  message, renderText, resolveLocale, setLanguagePreference, t,
} from '../src/i18n';
import { appendEvent, getSavedEvents, persistEvents } from '../src/services/event_log';
import { subscribeStorageWriteFailures } from '../src/services/storage';
import { backend } from '../src/services/backend';
import GrokPanel from '../src/components/GrokPanel';
import ClaudePanel from '../src/components/ClaudePanel';
import QuotaOverview from '../src/components/QuotaOverview';
import { buildClaudeQuotaWindows, buildGrokQuotaWindows } from '../src/services/provider_summary';
import { formatResetTime } from '../src/utils/quota_format';

const notifications = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => 'granted',
  sendNotification: notifications.sendNotification,
}));

let renderer: ReactTestRenderer | undefined;
let stored: Map<string, string>;
let listeners: Map<string, (event: { key: string | null }) => void>;
beforeEach(() => {
  stored = new Map(); listeners = new Map();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', { languages: ['en-US'] });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal('document', { documentElement: { lang: '' } });
  vi.stubGlobal('window', {
    addEventListener: (name: string, callback: (event: { key: string | null }) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  setLanguagePreference('en');
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  setLanguagePreference('en');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('language ownership', () => {
  it('resolves Chinese variants and unsupported system languages without overriding explicit choices', () => {
    expect(resolveLocale('system', ['zh-TW', 'en'])).toBe('zh-CN');
    expect(resolveLocale('system', ['fr-FR', 'zh-CN'])).toBe('en');
    expect(resolveLocale('system', [])).toBe('en');
    expect(resolveLocale('en', ['zh-CN'])).toBe('en');
    expect(resolveLocale('zh-CN', ['en'])).toBe('zh-CN');
  });

  it('loads saved choice, syncs windows, follows system changes and releases listeners', () => {
    stored.set(LANGUAGE_STORAGE_KEY, 'zh-CN');
    const stop = initializeI18n();
    expect(getLocale()).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    stored.set(LANGUAGE_STORAGE_KEY, 'en');
    listeners.get('storage')!({ key: LANGUAGE_STORAGE_KEY });
    expect(getLocale()).toBe('en');
    vi.stubGlobal('navigator', { languages: ['zh-Hans'] });
    listeners.get('languagechange')!({ key: null });
    expect(getLocale()).toBe('en');
    setLanguagePreference('system');
    expect(getLanguagePreference()).toBe('system');
    expect(getLocale()).toBe('zh-CN');
    stored.delete(LANGUAGE_STORAGE_KEY);
    vi.stubGlobal('navigator', { languages: ['en-GB'] });
    listeners.get('storage')!({ key: null });
    expect(getLocale()).toBe('en');
    stop(); expect(listeners.size).toBe(0);
  });

  it('applies the language for this session and reports a failed preference write', () => {
    const failure = vi.fn(); const unsubscribe = subscribeStorageWriteFailures(failure);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('Disk full'); });
    expect(setLanguagePreference('zh-CN')).toBe(false);
    expect(getLocale()).toBe('zh-CN');
    expect(failure).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps complete matching placeholders and interpolates user values only once', () => {
    const parameters = (value: string) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
    for (const [key, english] of Object.entries(messages.en)) {
      const chinese = messages['zh-CN'][key as keyof typeof messages.en];
      expect(english.trim(), key).not.toBe('');
      expect(chinese.trim(), key).not.toBe('');
      expect(parameters(chinese), key).toEqual(parameters(english));
      expect(english, key).not.toMatch(/[\u4e00-\u9fff]/);
    }
    const value = message('View {p0} details', { p0: '<Grok>{p1}' });
    expect(renderText(value, 'en')).toBe('View <Grok>{p1} details');
    expect(renderText(value, 'zh-CN')).toBe('查看 <Grok>{p1} 详情');
  });
});

describe('live bilingual rendering', () => {
  it('switches a connected provider without refetching, losing quota or remounting data', async () => {
    const fetch = vi.spyOn(backend, 'getGrokInfo').mockResolvedValue({ connected: true, percentage: 27, periodType: 'weekly', periodLabel: 'Weekly' });
    await act(async () => { renderer = create(createElement(GrokPanel, { autoRefreshIntervalMs: 0 })); });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Weekly pool');
    expect(JSON.stringify(renderer!.toJSON())).toContain('73% remaining');
    await act(async () => { setLanguagePreference('zh-CN'); });
    expect(JSON.stringify(renderer!.toJSON())).toContain('每周额度池');
    expect(JSON.stringify(renderer!.toJSON())).toContain('剩余 73%');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Weekly pool');
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { setLanguagePreference('en'); });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Weekly pool');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['en', 'zh-CN'] as const)('keeps quota selection, weekly filtering and recovery functional in %s', (locale) => {
    setLanguagePreference(locale);
    const quota = { connected: true, session: { used: 32, limit: 100, percentage: 32 }, weeklyTotal: { used: 91, limit: 100, percentage: 91 } };
    const windows = buildClaudeQuotaWindows(quota);
    expect(windows.map((window) => window.label)).toEqual(['5-hour usage', '7-day usage']);
    expect(buildGrokQuotaWindows({ connected: true, percentage: 40, periodType: 'weekly' })[0].label).toBe('Weekly pool');
    const html = renderToStaticMarkup(createElement(QuotaOverview, {
      summaries: [{ id: 'claude', label: 'Claude', shortLabel: 'Claude', initials: 'C', accent: '#fff', connected: true, loading: false, usedPercent: 91, statusText: 'Ready' }],
      windows, display: { weekly: false }, onProviderSelect: vi.fn(), onRefresh: vi.fn(), onSettings: vi.fn(),
    }));
    expect(html).toContain('<strong>9%</strong>');
    expect(html).toContain('aria-valuenow="68"');
    expect(html).not.toContain('aria-valuenow="9"');
    expect(html).toContain(locale === 'en' ? 'Remaining quota' : '剩余额度');
    const recovery = renderToStaticMarkup(createElement(ClaudePanel, {
      quota: null, loading: false, error: 'Claude OAuth token expired', workspace: true, windowVisible: true, costRefreshKey: 0, onRetry: vi.fn(),
    }));
    expect(recovery).toContain(locale === 'en' ? 'Signed in, check again' : '我已登录，重新检测');
    const reset = formatResetTime((Date.now() + 2 * 3_600_000 + 60_000) / 1000);
    expect(reset).toContain(locale === 'en' ? '2h' : '2 小时');
  });

  it('persists event parameters and deduplicates the same event across languages', () => {
    const event = message('{provider} connected', { provider: 'Grok' });
    const events = appendEvent([], 'info', event, 1000, 'first');
    persistEvents(events);
    expect(renderText(getSavedEvents()[0].text)).toBe('Grok connected');
    setLanguagePreference('zh-CN');
    expect(renderText(getSavedEvents()[0].text)).toBe('Grok 已连接');
    expect(appendEvent(events, 'info', event, 2000)).toBe(events);
    expect(t('Refresh')).toBe('刷新');
  });
});

it('delivers localized notifications but deduplicates with language-independent content', async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  notifications.sendNotification.mockClear();
  const content = message('{provider} connected', { provider: 'Grok test notification' });
  setLanguagePreference('zh-CN');
  expect(await notify('QuotaBar', content)).toEqual({ status: 'sent' });
  expect(notifications.sendNotification).toHaveBeenCalledExactlyOnceWith({ title: 'QuotaBar', body: 'Grok test notification 已连接' });
  setLanguagePreference('en');
  expect(await notify('QuotaBar', content)).toEqual({ status: 'skipped', reason: 'duplicate' });
  expect(notifications.sendNotification).toHaveBeenCalledTimes(1);
});

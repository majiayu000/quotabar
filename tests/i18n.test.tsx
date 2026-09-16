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
import CodexPanel from '../src/components/CodexPanel';
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
  it.each([
    ['local Astra', 900_000_000, 900_000_000],
    ['mixed usage without an Astra quota sample', 900_000_000, null],
    ['no Astra model in local usage', 900_000_000, undefined],
    ['missing local conversion', null, null],
    ['zero local conversion', 0, null],
    ['invalid local conversion', Number.NaN, null],
  ])('switches local and community capacities in both languages: %s', async (_case, astraEquivalent, astraTokens) => {
    const isLocal = astraEquivalent === 900_000_000;
    const observedAt = new Date().toISOString();
    const resetsAt = Math.floor(Date.now() / 1000) + 86400;
    vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true });
    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({
      connected: true, secondary: { usedPercent: 40, windowMinutes: 10_080, resetsAt },
    });
    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({ connected: true, availableCount: 0, credits: [] });
    const fetch = vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({
      valueEstimate: {
        observedAt, resetsAt: new Date(resetsAt * 1000).toISOString(),
        windowStartedAt: new Date((resetsAt - 604800) * 1000).toISOString(),
        usedPct: 40, observedCostUsd: 80, estimatedWeeklyValueUsd: 200,
        observedTokens: 360_000_000, estimatedWeeklyTokens: 900_000_000,
        astraEquivalentWeeklyTokens: astraEquivalent,
        modelEstimates: [
          ...(astraTokens === undefined ? [] : [{ model: 'gpt-6-astra', estimatedWeeklyTokens: astraTokens, sampleTokens: 90_000_000, sampleUsedPct: 10 }]),
          { model: 'gpt-5.6-sol', estimatedWeeklyTokens: 2_000_000_000, sampleTokens: 200_000_000, sampleUsedPct: 10 },
          { model: 'gpt-5.6-luna', estimatedWeeklyTokens: null, sampleTokens: 0, sampleUsedPct: 0 },
          { model: 'codex-auto-review', estimatedWeeklyTokens: 12_000_000_000, sampleTokens: 1_200_000_000, sampleUsedPct: 10 },
        ],
      },
    });
    await act(async () => { renderer = create(createElement(CodexPanel, { autoRefreshIntervalMs: 0, showCostSummary: false })); });
    const rows = () => renderer!.root.findAllByProps({ className: 'weekly-model-estimate' });
    const toggle = () => renderer!.root.findByProps({ className: 'weekly-value-source-toggle' });
    expect(toggle().props.disabled).toBe(!isLocal);
    expect(toggle().props['aria-label']).toBe(isLocal ? 'Switch to community reference' : 'Local estimate unavailable');
    expect(rows()).toHaveLength(2);
    expect(rows().map((row) => row.findByType('span').children.join(''))).toEqual(['Astra', 'GPT-5.6 Sol']);
    expect(rows()[0].findByType('strong').children.join('')).toBe(isLocal ? '≈900M tokens / week' : '≈853.5M tokens / week');
    expect(rows()[1].findByType('strong').children.join('')).toBe(isLocal ? '≈2.3B tokens / week' : '≈3.6B tokens / week');
    expect(JSON.stringify(renderer!.toJSON())).toContain(isLocal ? 'Price conversion from Astra · 2.5× tokens' : 'Community reference');
    for (const unwanted of ['codex-auto-review', 'gpt-5.6-luna', 'If only', 'Insufficient sample']) {
      expect(JSON.stringify(renderer!.toJSON())).not.toContain(unwanted);
    }
    expect(JSON.stringify(renderer!.toJSON())).toContain('These alternatives cannot be added together');
    await act(async () => { setLanguagePreference('zh-CN'); });
    expect(rows()[0].findByType('span').children.join('')).toBe('Astra');
    expect(rows()[0].findByType('strong').children.join('')).toBe(isLocal ? '≈9亿 Token / 周' : '≈8.5亿 Token / 周');
    expect(rows()[1].findByType('strong').children.join('')).toBe(isLocal ? '≈22.5亿 Token / 周' : '≈36亿 Token / 周');
    const chinese = JSON.stringify(renderer!.toJSON());
    expect(chinese).toContain(isLocal ? '按 Astra 价格折算 · 2.5 倍 Token' : '社区参考');
    expect(chinese).not.toContain('样本不足');
    expect(chinese).not.toContain('若全用');
    if (!isLocal) {
      expect(chinese).toContain('Pro 20×');
      expect(chinese).toContain('非当前账户额度');
      expect(chinese).toContain('codex-quota.manetli.com');
      expect(chinese).toContain('2026-09-16');
    }
    expect(JSON.stringify(renderer!.toJSON())).toContain('同一份周额度的不同用法，不能相加');
    if (isLocal) {
      expect(toggle().props['aria-label']).toBe('切换到社区参考');
      await act(async () => { toggle().props.onClick(); });
      expect(rows()[0].findByType('strong').children.join('')).toBe('≈8.5亿 Token / 周');
      expect(rows()[1].findByType('strong').children.join('')).toBe('≈36亿 Token / 周');
      expect(toggle().props['aria-label']).toBe('切换到本机估算');
      await act(async () => { setLanguagePreference('en'); });
      expect(toggle().props['aria-label']).toBe('Switch to local estimate');
      expect(rows()[0].findByType('strong').children.join('')).toBe('≈853.5M tokens / week');
      await act(async () => { toggle().props.onClick(); });
      expect(rows()[0].findByType('strong').children.join('')).toBe('≈900M tokens / week');
      expect(rows()[1].findByType('strong').children.join('')).toBe('≈2.3B tokens / week');
      expect(renderer!.root.findByProps({ className: 'weekly-value-gauge-center' }).findByType('strong').children.join('')).toBe('60%');
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('localizes a Codex valuation failure and isolates raw diagnostics (missing prices: %s)', async (missingPrices) => {
    const diagnostic = missingPrices
      ? 'cannot price Codex models in the active weekly window: gpt-reserve'
      : 'failed to load pricing data: network offline';
    vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true });
    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({
      connected: true,
      secondary: { usedPercent: 40, windowMinutes: 10_080, resetsAt: Math.floor(Date.now() / 1000) + 86400 },
    });
    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({ connected: true, availableCount: 0, credits: [] });
    const fetch = vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({
      valueEstimateError: { diagnostic, unpricedModels: missingPrices ? 'gpt-reserve' : undefined },
    });
    setLanguagePreference('zh-CN');
    await act(async () => { renderer = create(createElement(CodexPanel, { autoRefreshIntervalMs: 0, showCostSummary: false })); });
    const card = () => renderer!.root.findByProps({ className: 'quota-card weekly-value-card' });
    const copy = () => card().findByProps({ className: 'quota-pace warning' }).children.join('');
    expect(copy()).toBe(missingPrices
      ? '缺少 gpt-reserve 的价格，暂时无法计算每周估值。'
      : '暂时无法计算每周估值，请展开诊断详情查看原因。');
    const details = card().findByType('details');
    expect(details.props.open).toBeUndefined();
    expect(details.findAllByType('p')[1].children.join('')).toBe(diagnostic);
    expect(details.findByProps({ className: 'quota-pace warning' })).toBeDefined();
    expect(card().findAllByProps({ className: 'weekly-model-estimate' })).toHaveLength(2);
    expect(card().findByProps({ className: 'weekly-value-source-toggle' }).props.disabled).toBe(true);
    expect(details.findByType('summary').children.join('')).toBe('诊断详情');
    await act(async () => { setLanguagePreference('en'); });
    expect(copy()).toBe(missingPrices
      ? 'Weekly value unavailable because prices are missing for gpt-reserve.'
      : 'Weekly value could not be calculated. See diagnostics for details.');
    expect(card().findByType('summary').children.join('')).toBe('Diagnostics');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByProps({ 'aria-label': 'Weekly quota remaining quota' }).props['aria-valuenow']).toBe(60);
  });

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

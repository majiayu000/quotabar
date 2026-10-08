import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AnalysisReport } from '../src/services/backend';
import { setLanguagePreference } from '../src/i18n';
import { getSavedPlanPrices, savePlanPrices, withPlanPrice } from '../src/services/plan_prices';
import {
  buildValueExport, formatMultiple, previousMonthRange, providerValue, renderValueCardSvg,
  subscriptionValueRows, subscriptionValueTotals, withPrefix,
} from '../src/services/subscription_value';

type Summary = AnalysisReport['summaries'][number]['summary'];
type Model = Summary['models'][number];

const tokens = (total: number) => ({ reasoning_tokens: 0, reported_total_adjustment: 0, total_tokens: total, input_tokens: total, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cache_hit_rate: null });
function model(name: string, cost: number | null, extra: Partial<Model> = {}): Model {
  return { model: name, currency: 'USD', cost, cost_usd: cost, cost_kind: 'estimated_api', pricing_source: 'litellm', api_equivalent_cost_coverage: null, tokens: tokens(100), ...extra };
}
function summary(cost: number | null, models: Model[], extra: Partial<Summary> = {}): Summary {
  return { currency: 'USD', cost, cost_usd: cost, cost_kind: 'estimated_api', pricing_source: 'litellm', api_equivalent_cost_coverage: null, tokens: tokens(1000), valid_entries: 10, parse_error_entries: 0, skipped_entries: 0, models, ...extra };
}
function report(summaries: Record<string, Summary>, errors: string[] = []): AnalysisReport {
  return {
    since: '2026-10-01', until: '2026-10-05', timezone: 'UTC', generated_at: '2026-10-05T00:00:00Z',
    available_models: [], available_projects: [], hourly: [], projects: [], history: [],
    summaries: Object.entries(summaries).map(([source, item]) => ({ source, summary: item })),
    errors,
  };
}

afterEach(() => {
  setLanguagePreference('en');
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('subscription value math', () => {
  test('computes value, multiple and totals for priced providers', () => {
    const data = report({ claude: summary(1200, [model('claude-opus', 1200)]), codex: summary(90, [model('gpt-5', 90)]) });
    const rows = subscriptionValueRows(data, { claude: 200, codex: 20 });
    expect(rows.map((row) => [row.provider, row.value.valueUsd, row.multiple, row.prefix])).toEqual([
      ['claude', 1200, 6, '≈'],
      ['codex', 90, 4.5, '≈'],
    ]);
    const totals = subscriptionValueTotals(rows);
    expect(totals).toMatchObject({ basis: 'priced_plans', pricedProviders: 2, valueUsd: 1290, priceUsd: 220, prefix: '≈' });
    expect(totals.multiple).toBeCloseTo(1290 / 220);
    expect(withPrefix(totals.prefix, formatMultiple(totals.multiple))).toBe('≈ 5.9×');
  });

  test('recorded costs have no prefix', () => {
    const data = report({ cursor: summary(40, [model('auto', 40)], { cost_kind: 'real', pricing_source: 'recorded' }) });
    const [row] = subscriptionValueRows(data, { cursor: 20 });
    expect(row.prefix).toBe('');
    expect(row.multiple).toBe(2);
  });

  test('missing price keeps the value but has no multiple', () => {
    const rows = subscriptionValueRows(report({ claude: summary(300, [model('claude', 300)]) }), {});
    expect(rows).toHaveLength(1);
    expect(rows[0].priceUsd).toBeNull();
    expect(rows[0].multiple).toBeNull();
    const totals = subscriptionValueTotals(rows);
    expect(totals).toMatchObject({ basis: 'all_providers', valueUsd: 300, priceUsd: null, multiple: null });
  });

  test('unknown cost stays unknown instead of zero', () => {
    const data = report({ grok: summary(null, [model('grok-4', null)]) });
    const rows = subscriptionValueRows(data, { grok: 30 });
    expect(rows[0].value.valueUsd).toBeNull();
    expect(rows[0].multiple).toBeNull();
    expect(formatMultiple(rows[0].multiple)).toBe('—');
    expect(subscriptionValueTotals(rows)).toMatchObject({ valueUsd: null, multiple: null, prefix: '' });
  });

  test('incomplete pricing, parse failures and source errors produce lower bounds', () => {
    const coverage = report({ claude: summary(100, [model('claude', 100)], { api_equivalent_cost_coverage: { percent: 80, cost_is_lower_bound: true } }) });
    expect(providerValue(coverage, 'claude')).toMatchObject({ valueUsd: 100, lowerBound: true });
    const parse = report({ claude: summary(100, [model('claude', 100)], { parse_error_entries: 2 }) });
    expect(providerValue(parse, 'claude').lowerBound).toBe(true);
    const failed = report({ claude: summary(100, [model('claude', 100)]) }, ['claude · 用量：boom']);
    expect(subscriptionValueRows(failed, { claude: 50 })[0]).toMatchObject({ prefix: '≥', multiple: 2 });
  });

  test('an unknown priced provider makes the combined value a lower bound', () => {
    const data = report({ claude: summary(400, [model('claude', 400)]), grok: summary(null, [model('grok', null)]) });
    const totals = subscriptionValueTotals(subscriptionValueRows(data, { claude: 200, grok: 30 }));
    expect(totals).toMatchObject({ valueUsd: 400, priceUsd: 230, prefix: '≥' });
  });

  test('excludes GPT-Reserve complimentary usage from Codex value', () => {
    const data = report({ codex: summary(150, [model('gpt-5', 100), model('gpt-reserve', 50)]) });
    const value = providerValue(data, 'codex');
    expect(value).toMatchObject({ valueUsd: 100, lowerBound: false, excludedModels: ['gpt-reserve'] });
    const unpricedReserve = report({ codex: summary(100, [model('gpt-5', 100), model('gpt-reserve', null)], { api_equivalent_cost_coverage: { percent: 90, cost_is_lower_bound: true } }) });
    expect(providerValue(unpricedReserve, 'codex')).toMatchObject({ valueUsd: 100, lowerBound: false });
    const onlyReserve = report({ codex: summary(50, [model('gpt-reserve', 50)]) });
    expect(providerValue(onlyReserve, 'codex').valueUsd).toBe(0);
    const otherProvider = report({ claude: summary(10, [model('gpt-reserve', 10)]) });
    expect(providerValue(otherProvider, 'claude').valueUsd).toBe(10);
  });

  test('a price without local records is listed as unknown', () => {
    const rows = subscriptionValueRows(report({}), { cursor: 20 });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatchObject({ available: false, valueUsd: null });
  });

  test('previous month range covers the whole calendar month', () => {
    expect(previousMonthRange(new Date(2026, 0, 15))).toEqual({ since: '2025-12-01', until: '2025-12-31' });
    expect(previousMonthRange(new Date(2026, 2, 31))).toEqual({ since: '2026-02-01', until: '2026-02-28' });
  });
});

describe('subscription value export', () => {
  const data = report({ claude: summary(1200, [model('claude-opus', 1200)]), codex: summary(150, [model('gpt-5', 100), model('gpt-reserve', 50)]) });
  const rows = () => subscriptionValueRows(data, { claude: 200, codex: 20 });

  test('JSON and SVG share the same numbers', () => {
    const exported = buildValueExport(data, rows(), { hideSource: false, monthToDate: true, exportedAt: 'fixed' });
    expect(exported.totals).toMatchObject({ value_usd: 1300, plan_price_usd: 220, value_label: '≈ $1,300.00', multiple_label: '≈ 5.9×' });
    expect(exported.providers?.map((row) => [row.name, row.value_label, row.multiple_label])).toEqual([
      ['Claude', '≈ $1,200.00', '≈ 6.0×'], ['Codex', '≈ $100.00', '≈ 5.0×'],
    ]);
    expect(exported.exclusions).toEqual(['Excludes GPT-Reserve complimentary usage']);
    const svg = renderValueCardSvg(exported);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    for (const text of ['≈ 5.9×', '≈ $1,300.00', '$220.00', 'Claude', 'Codex', 'not a bill', 'October 2026 · Month to date']) expect(svg).toContain(text);
  });

  test('hiding sources removes service names and identifiers from JSON and SVG', () => {
    const exported = buildValueExport(data, rows(), { hideSource: true, monthToDate: false, exportedAt: 'fixed' });
    expect(exported.providers).toBeUndefined();
    expect(exported.exclusions).toBeUndefined();
    const json = JSON.stringify(exported);
    const svg = renderValueCardSvg(exported);
    for (const output of [json, svg]) {
      for (const secret of ['Claude', 'claude', 'Codex', 'codex', 'gpt-reserve', 'GPT-Reserve', '@', 'session', 'token', 'account']) expect(output).not.toContain(secret);
    }
    expect(svg).toContain('≈ 5.9×');
    expect(svg).toContain('2 plans compared · Service names hidden');
    expect(svg).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" rx="24" fill="#f6f7f8"/><rect x="28" y="28" width="904" height="484" rx="16" fill="#ffffff" stroke="#e2e4e8"/><g font-family="'DM Sans', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"><rect x="72" y="66" width="28" height="28" rx="7" fill="#5e6ad2"/><text x="86" y="86" text-anchor="middle" font-size="16" font-weight="700" fill="#ffffff">Q</text><text x="112" y="87" font-size="18" font-weight="600" fill="#23252a">QuotaBar</text><text x="888" y="87" text-anchor="end" font-size="15" fill="#626671">October 2026</text><text x="72" y="146" font-size="13" font-weight="600" letter-spacing="1.4" fill="#5e6ad2">SUBSCRIPTION VALUE</text><text x="70" y="230" font-size="76" font-weight="600" letter-spacing="-2" fill="#23252a" style="font-variant-numeric:tabular-nums">≈ 5.9×</text><text x="72" y="268" font-size="18" fill="#626671">≈ $1,300.00 of API-equivalent usage from $220.00 / month in plans</text><path d="M72 298H888" stroke="#e2e4e8"/><text x="72" y="336" font-size="15" fill="#626671">2 plans compared · Service names hidden</text><text x="72" y="474" font-size="12.5" fill="#626671">API-equivalent estimate from local logs, not a bill</text><text x="72" y="494" font-size="12.5" fill="#626671">≈ marks reference pricing</text></g></svg>"`);
  });

  test('escapes text and localizes card copy', () => {
    setLanguagePreference('zh-CN');
    const exported = buildValueExport(data, rows(), { hideSource: false, monthToDate: true, exportedAt: 'fixed' });
    exported.month_label = '<b>&';
    const svg = renderValueCardSvg(exported);
    expect(svg).toContain('&lt;b&gt;&amp;');
    expect(svg).toContain('订阅价值');
    expect(svg).toContain('不代表账单');
  });

  test('missing prices produce a value-only card without a fake multiple', () => {
    const exported = buildValueExport(data, subscriptionValueRows(data, {}), { hideSource: false, monthToDate: true, exportedAt: 'fixed' });
    expect(exported.totals).toMatchObject({ basis: 'all_providers', multiple: null, multiple_label: '—', plan_price_label: '—' });
    const svg = renderValueCardSvg(exported);
    expect(svg).toContain('Add plan prices in QuotaBar to see the multiple');
    expect(svg).toContain('No plan price');
  });
});

describe('plan prices', () => {
  test('default to empty and reject invalid saved values', () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) };
    expect(getSavedPlanPrices()).toEqual({});
    savePlanPrices({ claude: 200 });
    expect(getSavedPlanPrices()).toEqual({ claude: 200 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store.set('quotabar.plan-prices', JSON.stringify({ claude: 0 }));
    expect(getSavedPlanPrices()).toEqual({});
  });

  test('blank or non-positive input clears a price', () => {
    expect(withPlanPrice({ claude: 200 }, 'claude', '')).toEqual({});
    expect(withPlanPrice({ claude: 200 }, 'claude', '-1')).toEqual({});
    expect(withPlanPrice({}, 'grok', '30')).toEqual({ grok: 30 });
  });
});

describe('subscription value section', () => {
  test('shows multiples for priced plans, a price prompt otherwise and never a zero for unknown value', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SubscriptionValueSection } = await import('../src/components/SubscriptionValue');
    const data = report({ claude: summary(1200, [model('claude', 1200)]), grok: summary(null, [model('grok', null)]), cursor: summary(12, [model('auto', 12)]) });
    const html = renderToStaticMarkup(createElement(SubscriptionValueSection, { month: 'current', onMonthChange: () => undefined, state: { report: data, loading: false }, prices: { claude: 200, grok: 30 }, onSetPrices: () => undefined }));
    expect(html).toContain('≈ 6.0×');
    expect(html).toContain('≥ $1,200.00');
    expect(html).toContain('Set price');
    expect(html).toContain('API-equivalent estimate from local logs, not a bill');
    expect(html).toContain('Settings → Accounts');
    expect(html).not.toContain('$0.00');
  });
});

import { getLocale, t } from '../i18n';
import type { AnalysisReport } from './backend';
import { PLAN_PRICE_PROVIDERS, type PlanPriceProvider, type PlanPrices } from './plan_prices';
import { SERVICE_META } from './service_meta';

/**
 * Subscription value compares local API-equivalent estimates (from the shared
 * analysis report) with user-entered monthly plan prices. It is never a bill.
 */

/** Usage drawn from a separate complimentary pool is not value delivered by the plan. */
export const VALUE_EXCLUDED_MODELS: Partial<Record<PlanPriceProvider, readonly string[]>> = {
  codex: ['gpt-reserve'],
};

export type ValuePrefix = '' | '≈' | '≥';
export type ValueStatus = 'known' | 'estimate' | 'lower_bound' | 'unknown';

export interface ProviderValue {
  provider: PlanPriceProvider;
  /** The source appeared in the report. */
  available: boolean;
  /** API-equivalent USD; null when no part of the usage could be priced. */
  valueUsd: number | null;
  lowerBound: boolean;
  estimated: boolean;
  /** Excluded models that had usage in this period. */
  excludedModels: string[];
}

export interface ValueRow {
  provider: PlanPriceProvider;
  label: string;
  value: ProviderValue;
  priceUsd: number | null;
  multiple: number | null;
  prefix: ValuePrefix;
}

export interface ValueTotals {
  /** priced_plans: totals cover providers with a plan price. all_providers: no price is set. */
  basis: 'priced_plans' | 'all_providers';
  pricedProviders: number;
  valueUsd: number | null;
  priceUsd: number | null;
  multiple: number | null;
  prefix: ValuePrefix;
}

type SourceSummary = AnalysisReport['summaries'][number]['summary'];
type ModelSummary = SourceSummary['models'][number];

const isLowerBoundModel = (model: ModelSummary) => model.cost_usd === null || model.api_equivalent_cost_coverage?.cost_is_lower_bound === true;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function valuePrefix(value: Pick<ProviderValue, 'valueUsd' | 'lowerBound' | 'estimated'>): ValuePrefix {
  if (value.valueUsd === null) return '';
  return value.lowerBound ? '≥' : value.estimated ? '≈' : '';
}

export function valueStatus(value: Pick<ProviderValue, 'valueUsd' | 'lowerBound' | 'estimated'>): ValueStatus {
  if (value.valueUsd === null) return 'unknown';
  return value.lowerBound ? 'lower_bound' : value.estimated ? 'estimate' : 'known';
}

export function providerValue(report: AnalysisReport, provider: PlanPriceProvider): ProviderValue {
  const row = report.summaries.find((item) => item.source === provider);
  const sourceFailed = report.errors.some((error) => error.startsWith(`${provider} ·`));
  if (!row) return { provider, available: false, valueUsd: null, lowerBound: sourceFailed, estimated: false, excludedModels: [] };
  const summary = row.summary;
  const excluded = VALUE_EXCLUDED_MODELS[provider] ?? [];
  const excludedModels = summary.models.filter((model) => excluded.includes(model.model) && model.tokens.total_tokens > 0).map((model) => model.model);
  let valueUsd = summary.cost_usd;
  let lowerBound = summary.api_equivalent_cost_coverage?.cost_is_lower_bound === true;
  if (summary.models.some((model) => excluded.includes(model.model))) {
    // Recompute from the remaining models so the excluded pool neither adds
    // value nor makes the remaining estimate look incomplete.
    const included = summary.models.filter((model) => !excluded.includes(model.model));
    const known = included.filter((model) => model.cost_usd !== null).map((model) => model.cost_usd as number);
    valueUsd = included.length === 0 ? 0 : known.length ? sum(known) : null;
    lowerBound = included.some(isLowerBoundModel);
  }
  lowerBound = lowerBound || sourceFailed || summary.parse_error_entries > 0;
  const estimated = summary.cost_kind !== 'real' || summary.pricing_source !== 'recorded';
  return { provider, available: true, valueUsd, lowerBound, estimated, excludedModels };
}

export function subscriptionValueRows(report: AnalysisReport, prices: PlanPrices): ValueRow[] {
  return PLAN_PRICE_PROVIDERS.flatMap((provider) => {
    const value = providerValue(report, provider);
    const priceUsd = prices[provider] ?? null;
    if (!value.available && priceUsd === null) return [];
    const multiple = value.valueUsd !== null && priceUsd !== null && priceUsd > 0 ? value.valueUsd / priceUsd : null;
    return [{ provider, label: SERVICE_META[provider].label, value, priceUsd, multiple, prefix: valuePrefix(value) }];
  });
}

export function subscriptionValueTotals(rows: ValueRow[]): ValueTotals {
  const priced = rows.filter((row) => row.priceUsd !== null);
  const basis = priced.length ? 'priced_plans' : 'all_providers';
  const included = priced.length ? priced : rows;
  const known = included.filter((row) => row.value.valueUsd !== null);
  const valueUsd = known.length ? sum(known.map((row) => row.value.valueUsd as number)) : null;
  const priceUsd = priced.length ? sum(priced.map((row) => row.priceUsd as number)) : null;
  const lowerBound = included.some((row) => row.value.valueUsd === null || row.value.lowerBound);
  const estimated = known.some((row) => row.value.estimated);
  return {
    basis,
    pricedProviders: priced.length,
    valueUsd,
    priceUsd,
    multiple: valueUsd !== null && priceUsd !== null && priceUsd > 0 ? valueUsd / priceUsd : null,
    prefix: valuePrefix({ valueUsd, lowerBound, estimated }),
  };
}

export function formatUsd(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
}

export function formatMultiple(value: number | null): string {
  if (value === null) return '—';
  return `${new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}×`;
}

export const withPrefix = (prefix: ValuePrefix, text: string) => prefix && text !== '—' ? `${prefix} ${text}` : text;

const pad = (value: number) => String(value).padStart(2, '0');
const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The full previous calendar month in local dates. */
export function previousMonthRange(today: Date = new Date()): { since: string; until: string } {
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  return { since: isoDate(first), until: isoDate(last) };
}

export function monthLabel(since: string | null): string {
  if (!since) return '—';
  const [year, month] = since.split('-').map(Number);
  return new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'long' }).format(new Date(year, month - 1, 1));
}

export interface ValueExport {
  app: 'QuotaBar';
  kind: 'subscription_value';
  month: string | null;
  month_label: string;
  since: string | null;
  until: string | null;
  month_to_date: boolean;
  timezone: string;
  generated_at: string;
  exported_at: string;
  currency: 'USD';
  totals: {
    basis: ValueTotals['basis'];
    priced_plans: number;
    value_usd: number | null;
    value_label: string;
    value_status: ValueStatus;
    plan_price_usd: number | null;
    plan_price_label: string;
    multiple: number | null;
    multiple_label: string;
  };
  /** Omitted when service names are hidden. */
  providers?: {
    provider: PlanPriceProvider;
    name: string;
    value_usd: number | null;
    value_label: string;
    value_status: ValueStatus;
    plan_price_usd: number | null;
    plan_price_label: string;
    multiple: number | null;
    multiple_label: string;
  }[];
  exclusions?: string[];
  incomplete: boolean;
  note: string;
}

/** Build the shared JSON/SVG export. Hidden sources drop every per-service field. */
export function buildValueExport(report: AnalysisReport, rows: ValueRow[], options: { hideSource: boolean; monthToDate: boolean; exportedAt?: string }): ValueExport {
  const totals = subscriptionValueTotals(rows);
  const totalStatus = valueStatus({ valueUsd: totals.valueUsd, lowerBound: totals.prefix === '≥', estimated: totals.prefix === '≈' });
  const exclusions = rows.some((row) => row.value.excludedModels.includes('gpt-reserve')) ? [t("Excludes GPT-Reserve complimentary usage")] : [];
  return {
    app: 'QuotaBar',
    kind: 'subscription_value',
    month: report.since?.slice(0, 7) ?? null,
    month_label: monthLabel(report.since),
    since: report.since,
    until: report.until,
    month_to_date: options.monthToDate,
    timezone: report.timezone,
    generated_at: report.generated_at,
    exported_at: options.exportedAt ?? new Date().toISOString(),
    currency: 'USD',
    totals: {
      basis: totals.basis,
      priced_plans: totals.pricedProviders,
      value_usd: totals.valueUsd,
      value_label: withPrefix(totals.prefix, formatUsd(totals.valueUsd)),
      value_status: totalStatus,
      plan_price_usd: totals.priceUsd,
      plan_price_label: formatUsd(totals.priceUsd),
      multiple: totals.multiple,
      multiple_label: withPrefix(totals.prefix, formatMultiple(totals.multiple)),
    },
    ...(options.hideSource ? {} : {
      providers: rows.map((row) => ({
        provider: row.provider,
        name: row.label,
        value_usd: row.value.valueUsd,
        value_label: withPrefix(row.prefix, formatUsd(row.value.valueUsd)),
        value_status: valueStatus(row.value),
        plan_price_usd: row.priceUsd,
        plan_price_label: formatUsd(row.priceUsd),
        multiple: row.multiple,
        multiple_label: withPrefix(row.prefix, formatMultiple(row.multiple)),
      })),
      ...(exclusions.length ? { exclusions } : {}),
    }),
    incomplete: totalStatus === 'lower_bound' || totalStatus === 'unknown',
    note: t("API-equivalent estimate from local logs, not a bill"),
  };
}

const CARD_SOURCE_COLORS: Record<PlanPriceProvider, string> = { claude: '#b68a70', codex: '#5e6ad2', cursor: '#387d68', grok: '#8874b5' };
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Light share card using DESIGN.md desktop tokens. Renders only fields present in the export. */
export function renderValueCardSvg(data: ValueExport): string {
  const text = '#23252a'; const muted = '#626671'; const border = '#e2e4e8'; const accent = '#5e6ad2';
  const e = escapeXml;
  const parts: string[] = [];
  const period = data.month_to_date ? t("{p0} · Month to date", { p0: data.month_label }) : data.month_label;
  parts.push(`<rect x="72" y="66" width="28" height="28" rx="7" fill="${accent}"/><text x="86" y="86" text-anchor="middle" font-size="16" font-weight="700" fill="#ffffff">Q</text><text x="112" y="87" font-size="18" font-weight="600" fill="${text}">QuotaBar</text>`);
  parts.push(`<text x="888" y="87" text-anchor="end" font-size="15" fill="${muted}">${e(period)}</text>`);
  parts.push(`<text x="72" y="146" font-size="13" font-weight="600" letter-spacing="1.4" fill="${accent}">${e(t("SUBSCRIPTION VALUE"))}</text>`);
  const { totals } = data;
  const priced = totals.basis === 'priced_plans';
  const hero = priced ? totals.multiple_label : totals.value_label;
  const detail = priced
    ? totals.value_usd === null
      ? t("API-equivalent value unavailable · {p0} / month in plans", { p0: totals.plan_price_label })
      : t("{p0} of API-equivalent usage from {p1} / month in plans", { p0: totals.value_label, p1: totals.plan_price_label })
    : t("API-equivalent usage · Add plan prices in QuotaBar to see the multiple");
  parts.push(`<text x="70" y="230" font-size="76" font-weight="600" letter-spacing="-2" fill="${text}" style="font-variant-numeric:tabular-nums">${e(hero)}</text>`);
  parts.push(`<text x="72" y="268" font-size="18" fill="${muted}">${e(detail)}</text>`);
  parts.push(`<path d="M72 298H888" stroke="${border}"/>`);
  if (data.providers) {
    data.providers.slice(0, 4).forEach((row, index) => {
      const y = 336 + index * 36;
      parts.push(`<circle cx="78" cy="${y - 5}" r="5" fill="${CARD_SOURCE_COLORS[row.provider]}"/><text x="94" y="${y}" font-size="16" font-weight="600" fill="${text}">${e(row.name)}</text>`);
      parts.push(`<text x="500" y="${y}" text-anchor="end" font-size="16" fill="${text}" style="font-variant-numeric:tabular-nums">${e(row.value_label)}</text>`);
      parts.push(`<text x="720" y="${y}" text-anchor="end" font-size="14" fill="${muted}" style="font-variant-numeric:tabular-nums">${e(row.plan_price_usd === null ? t("No plan price") : t("Plan {p0} / mo", { p0: row.plan_price_label }))}</text>`);
      parts.push(`<text x="888" y="${y}" text-anchor="end" font-size="16" font-weight="600" fill="${row.multiple === null ? muted : accent}" style="font-variant-numeric:tabular-nums">${e(row.multiple_label)}</text>`);
    });
  } else {
    parts.push(`<text x="72" y="336" font-size="15" fill="${muted}">${e(priced ? t("{p0} plans compared · Service names hidden", { p0: totals.priced_plans }) : t("Service names hidden"))}</text>`);
  }
  const notes = [data.note, ...(data.exclusions ?? [])];
  const quality = data.incomplete ? t("≥ marks incomplete pricing; — marks unavailable values") : totals.value_status === 'estimate' ? t("≈ marks reference pricing") : null;
  parts.push(`<text x="72" y="${quality ? 474 : 494}" font-size="12.5" fill="${muted}">${e(notes.join(' · '))}</text>`);
  if (quality) parts.push(`<text x="72" y="494" font-size="12.5" fill="${muted}">${e(quality)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" rx="24" fill="#f6f7f8"/><rect x="28" y="28" width="904" height="484" rx="16" fill="#ffffff" stroke="${border}"/><g font-family="'DM Sans', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif">${parts.join('')}</g></svg>`;
}

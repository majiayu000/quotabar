import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useLocale } from '../i18n/react';
import { backend, type AnalysisQuery, type AnalysisRange, type AnalysisReport } from '../services/backend';
import type { PlanPrices } from '../services/plan_prices';
import {
  formatMultiple, formatUsd, monthLabel, previousMonthRange, subscriptionValueRows, subscriptionValueTotals, withPrefix,
} from '../services/subscription_value';

export type ValueMonth = 'current' | 'previous';
export interface ValueReportState { report?: AnalysisReport; error?: string; loading: boolean }

const FRESH_MS = 60_000;
const valueCache = new Map<string, { report: AnalysisReport; fetchedAt: number; refresh: number }>();

/** Drops cached month reports so each test starts without a module-level hit. */
export function clearSubscriptionValueCache() {
  valueCache.clear();
}

export function valueReportRequest(month: ValueMonth, today: Date = new Date()): { range: AnalysisRange; query: AnalysisQuery } {
  if (month === 'current') return { range: 'this_month', query: { model: null, project: null, since: null, until: null } };
  return { range: 'custom', query: { model: null, project: null, ...previousMonthRange(today) } };
}

/** Calendar-month report for all sources, unaffected by workspace filters. */
export function useSubscriptionValueReport(month: ValueMonth, refresh: number, enabled: boolean): ValueReportState {
  const { range, query } = valueReportRequest(month);
  const key = JSON.stringify([range, query]);
  const [state, setState] = useState<Record<string, { report?: AnalysisReport; error?: string; loading: boolean }>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!enabled) return;
    const cached = valueCache.get(key);
    if (cached && cached.refresh === refresh && Date.now() - cached.fetchedAt < FRESH_MS) {
      setState((current) => ({ ...current, [key]: { report: cached.report, loading: false } }));
      return;
    }
    let cancelled = false; let fresh = false;
    setState((current) => ({ ...current, [key]: { report: current[key]?.report ?? cached?.report, loading: true } }));
    if (!cached && !stateRef.current[key]?.report) {
      void backend.cachedAnalysisReport('all', range, query).then((saved) => {
        if (!cancelled && !fresh && saved) setState((current) => ({ ...current, [key]: { ...current[key], report: current[key]?.report ?? saved, loading: true } }));
      }, () => undefined);
    }
    const controller = new AbortController();
    backend.analysisReport('all', range, query, controller.signal).then(
      (report) => {
        fresh = true;
        valueCache.set(key, { report, fetchedAt: Date.now(), refresh });
        if (!cancelled) setState((current) => ({ ...current, [key]: { report, loading: false } }));
      },
      (reason) => { if (!cancelled) setState((current) => ({ ...current, [key]: { report: current[key]?.report, error: String(reason), loading: false } })); },
    );
    return () => { cancelled = true; controller.abort(); };
  }, [key, refresh, enabled]);
  return state[key] ?? { loading: enabled };
}

export function valuePeriodLabel(report: AnalysisReport | undefined, month: ValueMonth): string {
  if (!report) return month === 'current' ? t("This month") : t("Last month");
  const label = monthLabel(report.since);
  return month === 'current' ? t("{p0} · Month to date", { p0: label }) : label;
}

export function SubscriptionValueSection({ month, onMonthChange, state, prices, onSetPrices }: {
  month: ValueMonth; onMonthChange: (month: ValueMonth) => void; state: ValueReportState; prices: PlanPrices; onSetPrices: () => void;
}) {
  useLocale();
  const report = state.report;
  const rows = report ? subscriptionValueRows(report, prices) : [];
  const totals = subscriptionValueTotals(rows);
  const unpriced = rows.some((row) => row.priceUsd === null);
  const excludesReserve = rows.some((row) => row.value.excludedModels.includes('gpt-reserve'));
  return <section className="analysis-section workspace-value" aria-labelledby="workspace-value-title">
    <header><div><h2 id="workspace-value-title">{t("Subscription value")}</h2><p>{valuePeriodLabel(report, month)}{report ? ` · ${report.since} — ${report.until}` : ''}</p></div>
      <div className="analysis-ranges" aria-label={t("Value month")}>
        <button aria-pressed={month === 'current'} onClick={() => onMonthChange('current')}>{t("This month")}</button>
        <button aria-pressed={month === 'previous'} onClick={() => onMonthChange('previous')}>{t("Last month")}</button>
      </div></header>
    {state.error && <p className="analysis-error" role="alert">{report ? t("Refresh failed; showing stale data.") : t("Could not read this month's local usage: {p0}", { p0: state.error })}</p>}
    {!report && !state.error && <p className="analysis-empty" role="status">{t("Reading local usage for this month…")}</p>}
    {report && <>
      <div className="workspace-value-summary">
        <div><small>{t("Value multiple")}</small><strong>{totals.basis === 'priced_plans' ? withPrefix(totals.prefix, formatMultiple(totals.multiple)) : '—'}</strong><span>{totals.basis === 'priced_plans' ? t("API-equivalent value ÷ plan price") : t("Set a plan price to compare")}</span></div>
        <div><small>{totals.basis === 'priced_plans' ? t("Value from priced plans") : t("API-equivalent value")}</small><strong>{withPrefix(totals.prefix, formatUsd(totals.valueUsd))}</strong><span>{t("Reference value · Not a subscription bill")}</span></div>
        <div><small>{t("Plan prices")}</small><strong>{formatUsd(totals.priceUsd)}</strong><span>{t("Per month · Entered in Settings")}</span></div>
      </div>
      <div className="analysis-table-wrap"><table><thead><tr><th>{t("Service")}</th><th>{t("API-equivalent value")}</th><th>{t("Plan price / month")}</th><th>{t("Multiple")}</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.provider}>
          <td>{row.label}{!row.value.available && <small>{t("No local records this month")}</small>}</td>
          <td>{withPrefix(row.prefix, formatUsd(row.value.valueUsd))}</td>
          <td>{row.priceUsd === null ? <button className="analysis-text-button" onClick={onSetPrices}>{t("Set price")}</button> : formatUsd(row.priceUsd)}</td>
          <td>{withPrefix(row.prefix, formatMultiple(row.multiple))}</td>
        </tr>)}
      </tbody></table></div>
      {rows.length === 0 && <p className="analysis-empty">{t("No Claude, Codex, Cursor or Grok records this month. Add a plan price to track a service.")}</p>}
      <p className="workspace-chart-note">{t("API-equivalent estimate from local logs, not a bill")}{excludesReserve ? ` · ${t("Excludes GPT-Reserve complimentary usage")}` : ''}{totals.prefix === '≥' ? ` · ${t("≥ marks incomplete pricing; — marks unavailable values")}` : ''}</p>
      {unpriced && <p className="workspace-chart-note">{t("Add a monthly plan price in Settings → Accounts to see the multiple. No plan is assumed.")}</p>}
    </>}
  </section>;
}

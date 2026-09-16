import { localizeLabel, getLocale, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { useEffect, useState } from 'react';
import { backend, type AnalysisQuery, type AnalysisReport } from '../services/backend';

const count = (value: number) => new Intl.NumberFormat(getLocale()).format(value);

export function calendarDays(since: string | null, until: string | null): string[] {
  if (!since || !until) return [];
  const end = Date.parse(`${until}T00:00:00Z`);
  const start = Math.max(Date.parse(`${since}T00:00:00Z`), end - 365 * 86400000);
  const days: string[] = [];
  for (let time = start; time <= end; time += 86400000) days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}

export function TokenComposition({ report }: { report: AnalysisReport }) {
  useLocale();
  const rows = [
    ['input_tokens', t("Input")], ['output_tokens', t("Output")], ['cache_read_tokens', t("Cache read")],
    ['cache_creation_tokens', t("Cache write")], ['reasoning_tokens', t("Reasoning")], ['reported_total_adjustment', t("Source total adjustment")],
  ] as const;
  return <section className="analysis-section workspace-token-composition"><header><div><h2>{t("Token composition")}</h2><p>{t("Cache and reasoning are listed separately; totals come from source records.")}</p></div></header><dl>{rows.map(([key, label]) => {
    const value = report.summaries.reduce((sum, row) => sum + row.summary.tokens[key], 0);
    return <div key={key}><dt>{label}</dt><dd>{count(value)}</dd></div>;
  })}</dl></section>;
}

export function HourlyPlot({ report }: { report: AnalysisReport }) {
  useLocale();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));
  for (const group of report.hourly) for (const point of group.points) hourly[Number(point.hour.slice(11, 13))].total += point.tokens.total_tokens;
  const hourlyMax = Math.max(...hourly.map((point) => point.total), 1);
  return <div className="workspace-hourly" role="group" aria-label={t("Hourly usage distribution")}>{hourly.map(({ hour, total }) => <div key={hour} title={`${hour}:00 · ${count(total)} Tokens`} aria-label={`${hour}:00 · ${count(total)} Tokens`}><i style={{ height: `${total / hourlyMax * 100}%` }} /><small>{hour % 6 === 0 || hour === 23 ? `${hour}` : ''}</small></div>)}</div>;
}

export function UsageActivity({ report, onDate }: { report: AnalysisReport; onDate: (date: string) => void }) {
  useLocale();
  const daily = new Map<string, number>();
  for (const group of report.history) for (const point of group.points) daily.set(point.date, (daily.get(point.date) ?? 0) + point.tokens.total_tokens);
  const days = calendarDays(report.since, report.until);
  const max = Math.max(...daily.values(), 1);
  return <div className="workspace-activity-grid">
    <section className="analysis-section"><header><div><h2>{t("Activity calendar")}</h2><p>{days[0]} {t("to")}{" "}{days[days.length - 1]} {t("· Select a date to view sessions")}</p></div><small>{days.filter((day) => (daily.get(day) ?? 0) > 0).length} {t("days with records")}</small></header><div className="workspace-heatmap" role="group" aria-label={t("Daily usage calendar")}>{days.map((day) => {
      const value = daily.get(day) ?? 0;
      const label = `${day} · ${count(value)} Tokens${report.errors.length ? t(" · Incomplete data") : ''}`;
      return <button key={day} aria-label={label} title={label} onClick={() => onDate(day)} style={{ background: value ? `color-mix(in srgb, var(--a-blue) ${25 + value / max * 75}%, var(--a-surface))` : 'var(--a-control)' }}><span>{Number(day.slice(8))}</span></button>;
    })}</div><p className="workspace-chart-note">{t("Color shows usage; dates without records stay blank. Up to the last 366 days are shown.")}</p></section>
    <section className="analysis-section"><header><div><h2>{report.since === report.until ? t("Hourly usage for this day") : t("Hourly distribution")}</h2><p>{report.timezone} · {report.since === report.until ? t("Aggregated by recorded timestamps") : t("Usage at the same hour is summed across this range")}</p></div></header><HourlyPlot report={report} /><p className="workspace-chart-note">{t("Usage events do not measure time online, so hours worked are not estimated.")}</p></section>
  </div>;
}

export function previousPeriod(since: string, until: string) {
  const start = Date.parse(`${since}T00:00:00Z`);
  const length = Date.parse(`${until}T00:00:00Z`) - start + 86400000;
  return { since: new Date(start - length).toISOString().slice(0, 10), until: new Date(start - 86400000).toISOString().slice(0, 10) };
}

export function PeriodComparison({ report, source, query }: { report: AnalysisReport; source: string; query: AnalysisQuery }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [previous, setPrevious] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([source, query, report.since, report.until]);
  useEffect(() => {
    if (!open || !report.since || !report.until) return;
    let cancelled = false;
    setPrevious(null); setError(null);
    const controller = new AbortController();
    backend.analysisReport(source, 'custom', { ...query, ...previousPeriod(report.since, report.until) }, controller.signal).then(
      (result) => { if (!cancelled) setPrevious(result); },
      (reason) => { if (!cancelled) setError(String(reason)); },
    );
    return () => { cancelled = true; controller.abort(); };
  }, [open, key]);
  const total = (value: AnalysisReport) => value.summaries.reduce((sum, row) => sum + row.summary.tokens.total_tokens, 0);
  const before = previous ? total(previous) : 0;
  const now = total(report);
  const incomplete = !!previous?.errors.length || !!report.errors.length || [report, previous].some((value) => value?.summaries.some((row) => row.summary.parse_error_entries > 0));
  return <section className="workspace-comparison"><button disabled={!report.since || !report.until} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? t("Hide period comparison") : t("Compare previous period")} <span>↗</span></button>{open && <div>{error ? <p role="alert">{t("Could not load previous period:")}{" "}{localizeLabel(error)}</p> : previous ? <><p>{previous.since} — {previous.until} {t("· Using the same source, model and project filters")}</p><strong>{count(before)} → {count(now)} Tokens</strong><p>{incomplete ? t("Records are incomplete; growth is not calculated.") : before === 0 ? t("No usage in the previous period; growth is not calculated.") : t("{p0}{p1}% vs. previous period", { p0: now >= before ? '+' : '', p1: ((now / before - 1) * 100).toFixed(1) })}</p>{previous.errors.map((message) => <p role="alert" key={message}>{message}</p>)}</> : <p role="status">{t("Loading previous period…")}</p>}</div>}</section>;
}

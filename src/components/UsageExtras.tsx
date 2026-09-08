import { useEffect, useState } from 'react';
import { backend, type AnalysisQuery, type AnalysisReport } from '../services/backend';

const count = (value: number) => new Intl.NumberFormat('zh-CN').format(value);

export function calendarDays(since: string | null, until: string | null): string[] {
  if (!since || !until) return [];
  const end = Date.parse(`${until}T00:00:00Z`);
  const start = Math.max(Date.parse(`${since}T00:00:00Z`), end - 365 * 86400000);
  const days: string[] = [];
  for (let time = start; time <= end; time += 86400000) days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}

export function TokenComposition({ report }: { report: AnalysisReport }) {
  const rows = [
    ['input_tokens', '输入'], ['output_tokens', '输出'], ['cache_read_tokens', '缓存读取'],
    ['cache_creation_tokens', '缓存写入'], ['reasoning_tokens', '推理'], ['reported_total_adjustment', '来源总量调整'],
  ] as const;
  return <section className="analysis-section workspace-token-composition"><header><div><h2>Token 构成</h2><p>缓存与推理分别列出；总量以来源记录为准。</p></div></header><dl>{rows.map(([key, label]) => {
    const value = report.summaries.reduce((sum, row) => sum + row.summary.tokens[key], 0);
    return <div key={key}><dt>{label}</dt><dd>{count(value)}</dd></div>;
  })}</dl></section>;
}

export function HourlyPlot({ report }: { report: AnalysisReport }) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));
  for (const group of report.hourly) for (const point of group.points) hourly[Number(point.hour.slice(11, 13))].total += point.tokens.total_tokens;
  const hourlyMax = Math.max(...hourly.map((point) => point.total), 1);
  return <div className="workspace-hourly" role="group" aria-label="小时用量分布">{hourly.map(({ hour, total }) => <div key={hour} title={`${hour}:00 · ${count(total)} Tokens`} aria-label={`${hour}:00 · ${count(total)} Tokens`}><i style={{ height: `${total / hourlyMax * 100}%` }} /><small>{hour % 6 === 0 || hour === 23 ? `${hour}` : ''}</small></div>)}</div>;
}

export function UsageActivity({ report, onDate }: { report: AnalysisReport; onDate: (date: string) => void }) {
  const daily = new Map<string, number>();
  for (const group of report.history) for (const point of group.points) daily.set(point.date, (daily.get(point.date) ?? 0) + point.tokens.total_tokens);
  const days = calendarDays(report.since, report.until);
  const max = Math.max(...daily.values(), 1);
  return <div className="workspace-activity-grid">
    <section className="analysis-section"><header><div><h2>活动日历</h2><p>{days[0]} 至 {days[days.length - 1]} · 点击日期查看会话</p></div><small>{days.filter((day) => (daily.get(day) ?? 0) > 0).length} 个有记录的日期</small></header><div className="workspace-heatmap" role="group" aria-label="按日用量日历">{days.map((day) => {
      const value = daily.get(day) ?? 0;
      const label = `${day} · ${count(value)} Tokens${report.errors.length ? ' · 数据不完整' : ''}`;
      return <button key={day} aria-label={label} title={label} onClick={() => onDate(day)} style={{ background: value ? `color-mix(in srgb, var(--a-blue) ${25 + value / max * 75}%, var(--a-surface))` : 'var(--a-control)' }}><span>{Number(day.slice(8))}</span></button>;
    })}</div><p className="workspace-chart-note">颜色表示用量，无记录的日期留空；最多展示当前范围最后 366 天。</p></section>
    <section className="analysis-section"><header><div><h2>{report.since === report.until ? '当天小时用量' : '小时分布'}</h2><p>{report.timezone} · {report.since === report.until ? '按真实记录时间聚合' : '当前范围内相同钟点的用量相加'}</p></div></header><HourlyPlot report={report} /><p className="workspace-chart-note">用量事件不等于人的在线时长，因此不估算“工作时长”。</p></section>
  </div>;
}

export function previousPeriod(since: string, until: string) {
  const start = Date.parse(`${since}T00:00:00Z`);
  const length = Date.parse(`${until}T00:00:00Z`) - start + 86400000;
  return { since: new Date(start - length).toISOString().slice(0, 10), until: new Date(start - 86400000).toISOString().slice(0, 10) };
}

export function PeriodComparison({ report, source, query }: { report: AnalysisReport; source: string; query: AnalysisQuery }) {
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
  return <section className="workspace-comparison"><button disabled={!report.since || !report.until} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? '收起周期对比' : '对比上一周期'} <span>↗</span></button>{open && <div>{error ? <p role="alert">无法读取上一周期：{error}</p> : previous ? <><p>{previous.since} — {previous.until} · 使用相同来源、模型和项目筛选</p><strong>{count(before)} → {count(now)} Tokens</strong><p>{incomplete ? '记录不完整，暂不计算增长率。' : before === 0 ? '上一周期没有用量，暂不计算增长率。' : `较上一周期 ${now >= before ? '+' : ''}${((now / before - 1) * 100).toFixed(1)}%`}</p>{previous.errors.map((message) => <p role="alert" key={message}>{message}</p>)}</> : <p role="status">正在读取上一周期…</p>}</div>}</section>;
}

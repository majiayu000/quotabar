import { useEffect, useState, useId, useRef, useMemo, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { backend, hasTauriBackend, type AnalysisCatalog, type AnalysisMetrics, type AnalysisRange, type AnalysisReport, type AnalysisSession, type AnalysisTitle, type AnalysisView } from '../services/backend';
import { getSavedTheme, saveTheme } from '../services/app_state';
import { sortMostConstrained } from '../services/provider_summary';
import type { AppViewName } from '../services/provider_summary';
import type { ThemeName } from './ThemeSelector';
import '../styles/views.css';
import type { ProviderSummary, QuotaWindowSummary } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';
import { clampProgressValue, getProgressStyle } from '../utils/quota_format';
import CostSummarySection from './CostSummarySection';
import ProviderDetailHeader from './ProviderDetailHeader';
import ProviderIcon from './ProviderIcon';
import QuotaRecovery, { quotaRecovery, useQuotaCooldown } from './QuotaRecovery';
import ResetTimeline from './ResetTimeline';
import { calendarDays, HourlyPlot, PeriodComparison, TokenComposition, UsageActivity } from './UsageExtras';
import { defaultPanelSections, type PanelSectionVisibility } from '../services/panel_sections';

const ALL_COST_SOURCES = ['claude', 'codex', 'cursor'] as const;

type WorkspaceView = AnalysisView | 'quota' | 'settings';
const ANALYSIS_VIEWS: [WorkspaceView, string, string][] = [
  ['overview', '总览', '◫'], ['quota', '订阅额度', '◴'], ['usage', '用量明细', '▤'], ['history', '历史趋势', '↗'], ['sources', '数据来源', '⊙'], ['settings', '设置', '⚙'],
];
const ANALYSIS_RANGES: [AnalysisRange, string][] = [['today', '今天'], ['last_7_days', '7 天'], ['last_30_days', '30 天']];
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
const compactNumber = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const sourceColor = (source: string) => ({ codex: 'var(--a-blue)', claude: 'var(--a-clay)', cursor: 'var(--a-teal)', grok: '#8874b5', antigravity: '#ba935b', gemini: '#5380ba', opencode: '#899767' } as Record<string, string>)[source] ?? 'var(--a-slate)';
function SourceIcon({ source }: { source: string }) {
  return ['claude', 'codex', 'cursor', 'grok', 'antigravity'].includes(source) ? <ProviderIcon service={source as TrayServiceName} /> : <span>{source.slice(0, 2).toUpperCase()}</span>;
}
function WorkspaceIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    quota: 'M4 18a9 9 0 1 1 16 0 M12 13l5-5 M7 21h10',
    usage: 'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5',
    history: 'M3 3v18h18 M6 15l5-5 4 3 6-8',
    sources: 'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
    settings: 'M4 7h16 M4 17h16 M9 4v6 M15 14v6',
    theme: 'M20 14A9 9 0 0 1 10 4a9 9 0 1 0 10 10',
    refresh: 'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 13-3l2 3 M4 16l2 3a8 8 0 0 0 13-3',
    share: 'M12 15V3 M8 7l4-4 4 4 M5 12v9h14v-9',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
  };
  return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
const money = (value: number | null, currency = 'USD') => value === null ? '—' : new Intl.NumberFormat('zh-CN', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 6 : 2 }).format(value === 0 ? 0 : value);
export function analysisCostLabel(metrics: Omit<AnalysisMetrics, 'tokens' | 'cost_usd'>) {
  const prefix = metrics.api_equivalent_cost_coverage?.cost_is_lower_bound ? '≥ ' : metrics.cost_kind === 'real' && metrics.pricing_source === 'recorded' ? '' : '≈ ';
  return metrics.cost === null ? '—' : prefix + money(metrics.cost, metrics.currency);
}

function readSessionName(key: string) {
  try { return { title: localStorage.getItem(key), error: null as string | null }; }
  catch (error) { return { title: null, error: `无法读取手动名称：${String(error)}` }; }
}

export function AnalysisSessionName({ source, project, session, original, onNameChange }: {
  source: string; project: string; session: AnalysisSession; original?: AnalysisTitle; onNameChange?: () => void;
}) {
  const key = `quotabar.session-title:${JSON.stringify([source, session.session_id])}`;
  const [saved, setSaved] = useState(() => readSessionName(key));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const label = saved.title ?? original?.text ?? `${project} · ${new Date(session.first_timestamp).toLocaleString()} · ${session.session_id.slice(0, 8)}`;
  function save(value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
      setSaved({ title: value, error: null }); setError(null); setEditing(false); onNameChange?.();
    } catch (reason) { setError(`保存失败，原名称已保留：${String(reason)}`); }
  }
  return <div className="analysis-session-name">
    <h3>{label}</h3>
    <small>{saved.title !== null ? '手动命名' : original?.origin === 'source_title' ? '来源标题' : original ? '来源摘要' : '项目与会话标识'}</small>
    <code>{session.session_id}</code>
    {saved.error ? <p role="alert">{saved.error} <button onClick={() => setSaved(readSessionName(key))}>重试读取</button></p> : editing ?
      <form onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) { setError('请输入名称，或取消修改。'); return; } save(draft.trim()); }}>
        <label htmlFor={inputId}>会话名称</label><input autoFocus id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <small>仅保存在本机 QuotaBar，不修改原始记录和用量。</small>
        <div className="analysis-actions"><button type="submit">保存名称</button><button type="button" onClick={() => { setEditing(false); setError(null); }}>取消</button></div>
      </form> : <div className="analysis-actions"><button onClick={() => { setDraft(saved.title ?? original?.text ?? ''); setError(null); setEditing(true); }}>改名</button>{saved.title !== null && <button onClick={() => save(null)}>恢复来源名称</button>}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

function AnalysisProjects({ report, search }: { report: AnalysisReport; search: string; catalog: AnalysisCatalog | null }) {
  const [selected, setSelected] = useState<{ source: string; path: string } | null>(null);
  const selectedGroup = report.projects.find((group) => group.source_name === selected?.source);
  const project = selectedGroup?.projects.find((item) => item.project_path === selected?.path);
  const rows = report.projects.flatMap((group) => group.projects.map((item) => ({ source: group.source_name, label: group.display_name, item })))
    .filter(({ item, label }) => `${item.project_name} ${item.project_path} ${label}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => b.item.metrics.tokens.total_tokens - a.item.metrics.tokens.total_tokens);
  const unsupported = report.projects.filter((group) => group.projects.some((project) => !project.project_path)).map((group) => ({ source: group.display_name }));
  return <>
    {unsupported.length > 0 && <p className="analysis-notice">{unsupported.map(({ source }) => source).join('、')} 部分记录没有项目归属，已列入“未记录项目”；仍可查看对应会话。</p>}
    {report.projects.filter((group) => group.session_titles_error).map((group) => <p role="alert" key={group.source_name}>{group.display_name} 标题读取失败：{group.session_titles_error}</p>)}
    <div className={`analysis-explorer ${project ? 'has-selection' : ''}`}>
      <section className="analysis-section"><header><h2>项目</h2><small>{rows.length} 项 · 按 Tokens 排序</small></header>
        <div className="analysis-table-wrap"><table><thead><tr><th>名称</th><th>会话</th><th>Tokens</th><th>费用参考</th></tr></thead><tbody>
          {rows.map(({ source, label, item }) => <tr key={JSON.stringify([source, item.project_path])} className={source === selected?.source && item.project_path === selected?.path ? 'selected' : ''}>
            <td><button className="analysis-text-button" onClick={() => setSelected({ source, path: item.project_path })}>{item.project_name}</button><small>{label}</small></td>
            <td>{number(item.session_count)}</td><td>{number(item.metrics.tokens.total_tokens)}</td><td>{analysisCostLabel(item.metrics)}</td>
          </tr>)}
        </tbody></table></div>{rows.length === 0 && <p className="analysis-empty">{search ? '没有匹配的项目，试试清除搜索。' : '当前范围没有可展示的项目记录。'}</p>}
      </section>
      {project && selectedGroup && <aside className="analysis-detail"><header><div><small>{selectedGroup.display_name}</small><h2>{project.project_name}</h2></div><button aria-label="关闭项目详情" onClick={() => setSelected(null)}>×</button></header>
        <p className="analysis-path">{project.project_path}</p><div className="analysis-mini-metrics"><div><small>Tokens</small><strong>{number(project.metrics.tokens.total_tokens)}</strong></div><div><small>费用参考</small><strong>{analysisCostLabel(project.metrics)}</strong></div></div>
        <h2 className="analysis-session-heading">会话 · {project.session_count}</h2>
        {project.sessions.map((session) => <article className="analysis-session" key={JSON.stringify([selectedGroup.source_name, session.session_id])}>
          <AnalysisSessionName source={selectedGroup.source_name} project={project.project_name} session={session} original={selectedGroup.session_titles[session.session_id]} />
          <p>{new Date(session.last_timestamp).toLocaleString()} · 最近活动</p>
          <dl><div><dt>Tokens</dt><dd>{number(session.metrics.tokens.total_tokens)}</dd></div><div><dt>费用参考</dt><dd>{analysisCostLabel(session.metrics)}</dd></div></dl>
          <details><summary>费用依据</summary><p>{session.metrics.cost_kind} · {session.metrics.pricing_source}</p><p>估算不代表订阅账单。{session.metrics.api_equivalent_cost_coverage && `价格覆盖率 ${session.metrics.api_equivalent_cost_coverage.percent.toFixed(1)}%`}</p></details>
        </article>)}
      </aside>}
    </div>
  </>;
}

function AnalysisModels({ report, search }: { report: AnalysisReport; search: string }) {
  const rows = report.summaries.flatMap(({ source, summary }) => summary.models.map((model) => ({ source, model })))
    .filter(({ source, model }) => `${source} ${model.model}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.model.tokens.total_tokens - a.model.tokens.total_tokens);
  return <section className="analysis-section"><header><h2>模型用量</h2><small>{rows.length} 项 · 按 Tokens 排序</small></header><div className="analysis-table-wrap"><table><thead><tr><th>模型 / 来源</th><th>Tokens</th><th>缓存命中</th><th>费用参考</th></tr></thead><tbody>{rows.map(({ source, model }) => <tr key={JSON.stringify([source, model.model])}><td>{model.model}<small>{source}</small></td><td>{number(model.tokens.total_tokens)}</td><td>{model.tokens.cache_hit_rate === null ? '—' : `${model.tokens.cache_hit_rate.toFixed(1)}%`}</td><td>{analysisCostLabel(model)}</td></tr>)}</tbody></table></div>{rows.length === 0 && <p className="analysis-empty">{search ? '没有匹配的模型。' : '当前范围没有模型用量。'}</p>}</section>;
}

function AnalysisHistory({ report, compact = false, selectedDate, onSelectDate }: { report: AnalysisReport; compact?: boolean; selectedDate: string | null; onSelectDate: (date: string | null) => void }) {
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens');
  const rows = useMemo(() => report.history.flatMap((group) => group.points.map((point) => ({ ...point, source: group.display_name, sourceId: group.source_name, currency: group.currency }))).sort((a, b) => a.date.localeCompare(b.date)), [report]);
  const dates = calendarDays(report.since, report.until).map((date) => ({ date, points: rows.filter((row) => row.date === date) }));
  const value = (row: typeof rows[number]) => metric === 'tokens' ? row.tokens.total_tokens : row.cost_usd ?? 0;
  const max = Math.max(...dates.map(({ points }) => points.reduce((sum, row) => sum + value(row), 0)), 1) * 1.12;
  const incomplete = metric === 'cost' && rows.some((row) => row.cost_status !== 'known' || row.cost_usd === null);
  const tableRows = selectedDate ? rows.filter((row) => row.date === selectedDate) : rows;
  return <section className="analysis-section workspace-trend"><header><div><h2>用量趋势</h2><p>{report.since === report.until && metric === 'tokens' ? `按小时查看 · ${report.timezone}` : '按日查看 · 点击柱形查看当天来源与会话'}</p></div><div className="analysis-ranges" aria-label="图表指标"><button aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>Token</button><button aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>费用</button></div></header>
    {rows.length === 0 ? <p className="analysis-empty">当前周期没有历史记录。</p> : <>
      {report.since === report.until && metric === 'tokens' ? <HourlyPlot report={report} /> : <div className="workspace-plot"><div className="workspace-axis">{[1, .75, .5, .25, 0].map((scale) => <span key={scale}>{metric === 'tokens' ? compactNumber(max * scale) : money(max * scale)}</span>)}</div><div className="analysis-chart" role="group" aria-label="每日用量趋势">{dates.map(({ date, points }, index) => {
        const total = points.reduce((sum, row) => sum + value(row), 0);
        const label = `${date} · ${metric === 'tokens' ? number(total) + ' Tokens' : money(total) + ' USD 费用参考'}${metric === 'cost' && points.some((row) => row.cost_usd === null || row.cost_status !== 'known') ? ' · 价格不完整' : ''}`;
        return <button key={date} aria-label={label} title={label} aria-pressed={date === selectedDate} onClick={() => onSelectDate(date)}><span className="analysis-bar">{points.map((row) => <i key={row.sourceId} style={{ height: `${value(row) / max * 100}%`, background: sourceColor(row.sourceId) }} />)}</span>{dates.length < 10 || index % 5 === 0 || index === dates.length - 1 ? <small>{date.slice(5).replace('-', '.')}</small> : null}</button>;
      })}</div></div>}
      <div className="analysis-legend">{report.history.filter((group) => group.points.some((point) => point.tokens.total_tokens > 0)).map((group) => <span key={group.source_name}><i style={{ background: sourceColor(group.source_name) }} />{group.display_name}</span>)}</div>
      {report.since && dates[0]?.date > report.since && <p className="workspace-chart-note">图表展示当前范围最后 366 天；上方汇总覆盖全部所选日期。</p>}
      {incomplete && <p className="workspace-chart-note">费用仅绘制已知 USD 金额；缺失或参考价格不能当作实际扣款。</p>}
      {!compact && <><details className="workspace-history-ledger" open={!!selectedDate}><summary>每日来源明细 · {tableRows.length} 条</summary><div className="analysis-table-wrap"><table><thead><tr><th>日期 / 来源</th><th>Tokens</th><th>费用参考</th><th>完整性</th></tr></thead><tbody>{tableRows.map((row) => <tr key={`${row.sourceId}:${row.date}`}><td>{row.date}<small>{row.source}</small></td><td>{number(row.tokens.total_tokens)}</td><td>{analysisCostLabel(row)}</td><td>{row.cost_status === 'known' ? '已覆盖' : row.cost_status === 'partial' ? '部分 / 参考价格' : '未知'}</td></tr>)}</tbody></table></div></details></>}
    </>}
  </section>;
}

function SessionLedger({ report, compact = false, search = '', onExplore }: { report: AnalysisReport; compact?: boolean; search?: string; onExplore?: () => void }) {
  const [, setNameVersion] = useState(0);
  const [sort, setSort] = useState('recent');
  const [project, setProject] = useState('all');
  const [limit, setLimit] = useState(20);
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const rows = useMemo(() => report.projects.flatMap((group) => group.projects.flatMap((item) => item.sessions.map((session) => ({ id: JSON.stringify([group.source_name, session.session_id]), source: group.source_name, sourceLabel: group.display_name, project: item, session, title: group.session_titles[session.session_id] })))), [report]);
  const active = rows.find((row) => row.id === selected);
  useEffect(() => { if (active) dialog.current?.showModal(); else dialog.current?.close(); }, [active]);
  const matching = rows.map((row) => ({ ...row, saved: readSessionName(`quotabar.session-title:${row.id}`) })).filter((row) => (project === 'all' || row.project.project_path === project) && `${row.saved.title ?? row.title?.text ?? ''} ${row.project.project_name} ${row.sourceLabel} ${row.session.session_id}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'tokens' ? b.session.metrics.tokens.total_tokens - a.session.metrics.tokens.total_tokens : b.session.last_timestamp.localeCompare(a.session.last_timestamp));
  const visible = matching.slice(0, compact ? 4 : limit);
  return <section className="analysis-section workspace-sessions"><header><div><h2>{compact ? '最近的工作' : '会话明细'}</h2>{!compact && <p>来自真实记录的标题与用量 · 手动名称仅保存在本机</p>}</div>{compact ? <button onClick={onExplore}>全部会话 ↗</button> : <div className="analysis-actions"><select aria-label="筛选会话项目" value={project} onChange={(e) => { setProject(e.target.value); setLimit(20); }}><option value="all">全部项目</option>{[...new Map(rows.map((row) => [row.project.project_path, row.project.project_name])).entries()].map(([path, name]) => <option key={path} value={path}>{name}</option>)}</select><select aria-label="会话排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">最近活动 ↓</option><option value="tokens">按用量 ↓</option></select></div>}</header>
    {report.projects.filter((group) => group.session_titles_error).map((group) => <p className="analysis-error" role="alert" key={group.source_name}>{group.display_name} 标题读取失败：{group.session_titles_error}</p>)}
    <div className="analysis-table-wrap"><table><thead><tr><th>会话 / 项目</th><th>来源</th><th>Tokens</th><th>缓存命中</th><th>API 等价 / 记录费用</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td><button className="workspace-session-link" onClick={() => setSelected(row.id)}>{row.saved.title ?? row.title?.text ?? `${row.project.project_name} · ${row.session.session_id.slice(0, 8)}`}</button><small>{row.project.project_name} · {new Date(row.session.last_timestamp).toLocaleString()}</small>{row.saved.error && <small role="alert">{row.saved.error}</small>}</td><td><span className="workspace-source-pill"><span className="workspace-source-glyph" style={{ color: sourceColor(row.source) }}><SourceIcon source={row.source} /></span>{row.sourceLabel}</span></td><td title={number(row.session.metrics.tokens.total_tokens)}>{compactNumber(row.session.metrics.tokens.total_tokens)}</td><td className="workspace-cache">{row.session.metrics.tokens.cache_hit_rate === null ? '—' : `${row.session.metrics.tokens.cache_hit_rate.toFixed(1)}%`}</td><td>{analysisCostLabel(row.session.metrics)}</td></tr>)}</tbody></table></div>
    {!matching.length && <p className="analysis-empty">{search || project !== 'all' ? '没有匹配的会话，试试清除筛选。' : '当前来源没有可用会话归属，仍可查看模型与历史用量。'}</p>}
    <div className="workspace-table-footer"><span>{visible.length} / {matching.length} 个会话</span>{!compact && matching.length > limit ? <button onClick={() => setLimit((value) => value + 20)}>加载更多 ↓</button> : <span>估算费用不代表订阅账单</span>}</div>
    <dialog className="workspace-dialog" ref={dialog} onCancel={() => setSelected(null)} onClick={(e) => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) setSelected(null); } }} aria-label="会话详情">
      <button className="workspace-close" aria-label="关闭会话详情" onClick={() => setSelected(null)}>×</button>
      {active && <><span className="workspace-eyebrow">SESSION DETAIL / 会话详情</span><AnalysisSessionName key={active.id} source={active.source} project={active.project.project_name} session={active.session} original={active.title} onNameChange={() => setNameVersion((value) => value + 1)} /><p className="workspace-dialog-source">{active.sourceLabel} · {active.project.project_name}</p><div className="analysis-mini-metrics"><div><small>总 Token</small><strong>{number(active.session.metrics.tokens.total_tokens)}</strong></div><div><small>费用参考</small><strong>{analysisCostLabel(active.session.metrics)}</strong></div></div><dl className="workspace-detail-rows">{[['未缓存输入', active.session.metrics.tokens.input_tokens], ['缓存读取', active.session.metrics.tokens.cache_read_tokens], ['缓存写入', active.session.metrics.tokens.cache_creation_tokens], ['输出 Token', active.session.metrics.tokens.output_tokens]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(Number(value))}</dd></div>)}</dl><p>最近活动 · {new Date(active.session.last_timestamp).toLocaleString()}</p><details><summary>费用与数据依据</summary><p>{active.session.metrics.cost_kind} · {active.session.metrics.pricing_source}</p><p>使用来源报告的总量，命名不会改变用量。{active.session.metrics.api_equivalent_cost_coverage && `价格覆盖率 ${active.session.metrics.api_equivalent_cost_coverage.percent.toFixed(1)}%。`}估算不代表订阅账单。</p></details></>}
    </dialog>
  </section>;
}

function QuotaReadStatus({ provider }: { provider: ProviderSummary }) {
  const read = provider.readState;
  const recovery = quotaRecovery(provider.id, read?.error);
  return <span className="workspace-quota-freshness">
    {recovery && <span className="workspace-quota-error" role="alert">{recovery.title}{provider.connected ? ' · 当前显示旧数据' : ''}</span>}
    {read?.readAt && <small>最近成功读取 {new Date(read.readAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small>}
  </span>;
}

function CurrentQuotaRail({ summaries, windows, onSelect, onAll }: { summaries: ProviderSummary[]; windows: QuotaWindowSummary[]; onSelect: (provider: TrayServiceName) => void; onAll: () => void }) {
  const ready = summaries.filter((provider) => provider.connected);
  const ranked = sortMostConstrained(windows);
  const visible = [...(ready.length ? ready : summaries)].sort((a, b) => (ranked.find(w => w.provider === b.id)?.usedPercent ?? -1) - (ranked.find(w => w.provider === a.id)?.usedPercent ?? -1)).slice(0, 2);
  return <section className="analysis-section workspace-quota-rail"><header><h2>当前额度</h2><button onClick={onAll}>查看全部 ↗</button></header>{visible.map((provider) => {
    const window = ranked.find((item) => item.provider === provider.id);
    return <button className="workspace-quota-mini" key={provider.id} onClick={() => onSelect(provider.id)}>
      <span className="workspace-quota-identity"><span className="analysis-provider-icon" style={{ color: sourceColor(provider.id) }}><SourceIcon source={provider.id} /></span><b>{provider.label}</b><strong>{window ? `${Math.round(window.usedPercent)}%` : '—'}</strong></span>
      <span className="workspace-quota-meta"><span>{window ? `${window.label} · 已使用` : '暂无可用额度窗口'}</span><small>{provider.loading ? '更新中' : window?.resetLabel ? `${window.resetLabel} 后重置` : provider.connected ? '已连接' : '未连接'}</small></span>
      <progress max={100} value={window ? clampProgressValue(window.usedPercent) : 0} aria-label={`${provider.label} ${window?.label ?? '额度未知'}`} />
      <QuotaReadStatus provider={provider} />
    </button>;
  })}{!visible.length && <p className="analysis-empty">正在连接额度服务…</p>}<footer>账户窗口 · 独立于历史筛选</footer></section>;
}

export function WorkspaceQuotaCard({ provider, windows, onSelect, onRefresh }: {
  provider: ProviderSummary; windows: QuotaWindowSummary[]; onSelect: (provider: TrayServiceName) => void; onRefresh?: (provider: TrayServiceName) => void;
}) {
  const recovery = quotaRecovery(provider.id, provider.readState?.error);
  const cooling = useQuotaCooldown(provider.readState?.retryAt);
  const supported = provider.id !== 'antigravity';
  const ownWindows = windows.filter((item) => item.provider === provider.id);
  const loginNeeded = recovery && /登录/.test(recovery.title);
  return <section className="analysis-quota-card" data-provider={provider.id}>
    <header><div className="analysis-provider-icon"><SourceIcon source={provider.id} /></div><div><h2>{provider.label}</h2><small>{recovery ? recovery.title : provider.loading ? '正在读取…' : !supported ? '仅提供本机检测' : provider.connected ? '额度已同步' : '尚未检测到账户'}</small></div></header>
    {ownWindows.map((item) => <div className="analysis-quota-window" key={item.label}><div><span>{item.label}</span><strong>{Math.round(item.usedPercent)}% <small>已使用</small></strong></div><progress max={100} value={clampProgressValue(item.usedPercent)} /><small>{item.resetLabel ?? '重置时间未提供'}</small></div>)}
    {recovery ? <QuotaRecovery provider={provider.id} read={provider.readState} hasData={ownWindows.length > 0} /> : !ownWindows.length && <p className="analysis-quota-unavailable">{!supported ? '当前版本可检测安装情况，暂不提供订阅额度。' : provider.loading ? '正在读取账户额度…' : provider.connected ? '账户已连接，服务商未提供可展示的额度窗口。' : '完成服务商登录后，重新检测账户额度。'}</p>}
    {provider.readState?.readAt && <small className="workspace-quota-read-time">最近成功读取 {new Date(provider.readState.readAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}{recovery ? ' · 数据可能已过时' : ''}</small>}
    <div className="workspace-quota-card-actions"><button className="analysis-text-button" onClick={() => onSelect(provider.id)}>账户详情 →</button><button disabled={!onRefresh || provider.loading || cooling} onClick={() => onRefresh?.(provider.id)}>{cooling ? '等待重试' : provider.loading ? '正在读取…' : !supported ? '重新检测' : loginNeeded ? '我已登录，重新检测' : '刷新额度'}</button></div>
  </section>;
}

function WorkspaceQuotas({ summaries, windows, onSelect, onRefresh }: { onRefresh?: (provider: TrayServiceName) => void; summaries: ProviderSummary[]; windows: QuotaWindowSummary[]; onSelect: (provider: TrayServiceName) => void }) {
  return <div className="analysis-quota-grid">{summaries.map((provider) => <WorkspaceQuotaCard key={provider.id} provider={provider} windows={windows} onSelect={onSelect} onRefresh={onRefresh} />)}</div>;
}

export function AnalysisLoading({ progress }: { progress: string }) {
  return <div className="workspace-loading" role="status" aria-live="polite" aria-busy={true}>
    <div className="workspace-loading-caption"><span className="workspace-loading-spinner" aria-hidden="true" /><div><strong>{progress}</strong><p>统计准备好后会自动显示，你可以先切换到其他页面。</p></div></div>
    <div className="workspace-skeleton" aria-hidden="true">
      <div className="workspace-skeleton-metrics">{[0,1,2,3].map(item => <div key={item}><i /><b /><i /></div>)}</div>
      <div className="workspace-skeleton-chart"><i /><div /><i /></div>
      <div className="workspace-skeleton-rows">{[0,1,2].map(item => <div key={item}><i /><i /><i /></div>)}</div>
    </div>
  </div>;
}

export function AnalysisApp({ visible = true, providerContent, providerView, theme: workspaceTheme, summaries = [], quotaWindows = [], onProviderView, onThemeChange, onRefreshProvider }: {
  onRefreshProvider?: (provider: TrayServiceName) => void;
  providerContent?: ReactNode; providerView?: AppViewName; theme?: ThemeName;
  visible?: boolean;
  summaries?: ProviderSummary[]; quotaWindows?: QuotaWindowSummary[]; onProviderView?: (view: AppViewName) => void; onThemeChange?: (theme: ThemeName) => void;
} = {}) {
  const [catalog, setCatalog] = useState<AnalysisCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>('overview');
  const [range, setRange] = useState<AnalysisRange>('last_30_days');
  const [customDates, setCustomDates] = useState({ since: '', until: '' });
  const [appliedDates, setAppliedDates] = useState({ since: '', until: '' });
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [grouping, setGrouping] = useState<'session' | 'project' | 'model'>('session');
  const [modelChoice, setModelChoice] = useState('all');
  const [projectChoice, setProjectChoice] = useState('all');
  const [info, setInfo] = useState<'quality' | 'metrics' | null>(null);
  const infoDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (info) infoDialog.current?.showModal(); else infoDialog.current?.close(); }, [info]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [hideSource, setHideSource] = useState(false);
  const [savedExport, setSavedExport] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const shareDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (shareOpen) shareDialog.current?.showModal(); else shareDialog.current?.close(); }, [shareOpen]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [theme, setTheme] = useState(getSavedTheme);
  const previousProviderView = useRef(providerView);
  const providerPage = view === 'quota' || view === 'settings';
  function navigate(page: WorkspaceView) {
    setView(page); setSearch('');
    if (page === 'quota' || page === 'settings' || providerView === 'settings') {
      const next = page === 'settings' ? 'settings' : 'all';
      previousProviderView.current = next;
      onProviderView?.(next);
    }
  }
  useEffect(() => {
    if (providerView !== previousProviderView.current) {
      previousProviderView.current = providerView;
      setView(providerView === 'settings' ? 'settings' : 'quota');
    }
  }, [providerView]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLElement && event.target.closest('input,select,textarea,dialog') || document.querySelector('dialog[open]')) return;
      const page = ({ '1': 'overview', '2': 'quota', '3': 'usage', '4': 'history' } as const)[event.key as '1'];
      if (page) { event.preventDefault(); navigate(page); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [providerView, onProviderView]);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [view]);
  const [responses, setResponses] = useState<Record<string, { report?: AnalysisReport; error?: string }>>({});
  const [progressText, setProgressText] = useState('正在读取本地用量…');
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const query = { model: modelChoice === 'all' ? null : modelChoice, project: projectChoice === 'all' ? null : projectChoice, since: selectedDate ?? (range === 'custom' ? appliedDates.since : null), until: selectedDate ?? (range === 'custom' ? appliedDates.until : null) };
  const key = JSON.stringify([source, range, query]);
  const report = responses[key]?.report;
  const error = responses[key]?.error;
  const cachedResponses = useRef(responses);
  cachedResponses.current = responses;
  const previousRefresh = useRef(refresh);
  useEffect(() => {
    let cancelled = false;
    setCatalogError(null);
    backend.analysisCatalog().then((result) => { if (!cancelled) setCatalog(result); }, (reason) => { if (!cancelled) setCatalogError(String(reason)); });
    return () => { cancelled = true; };
  }, [refresh]);
  useEffect(() => {
    let cancelled = false; let changed = false; const stops: (() => void)[] = [];
    async function connect() {
      if (hasTauriBackend()) {
        const unlisten = await listen<string>('analysis-source-changed', (event) => {
          changed = true; setSource(event.payload); setView('overview'); setRefresh((value) => value + 1);
        });
        if (cancelled) { unlisten(); return; } stops.push(unlisten);

      }
      const initial = await backend.analysisSource();
      if (!cancelled && !changed) setSource(initial || 'all');
    }
    void connect().catch((reason) => { if (!cancelled) setActionError(`窗口连接失败：${String(reason)}`); });
    const syncTheme = () => setTheme(getSavedTheme());
    window.addEventListener('storage', syncTheme);
    return () => { cancelled = true; stops.forEach((stop) => stop()); window.removeEventListener('storage', syncTheme); };
  }, []);
  useEffect(() => {
    if (!source) return;
    const force = previousRefresh.current !== refresh;
    previousRefresh.current = refresh;
    if (!force && cachedResponses.current[key]?.report && Date.now() - Date.parse(cachedResponses.current[key].report!.generated_at) < 60_000) return;
    let cancelled = false;
    setLoadingKey(key); setCacheNotice(null); setProgressText('正在读取本地统计…');
    let freshSucceeded = false;
    if (!cachedResponses.current[key]?.report) {
      void backend.cachedAnalysisReport(source, range, JSON.parse(key)[2]).then((saved) => {
        if (!cancelled && !freshSucceeded && saved) setResponses((current) => ({ ...current, [key]: { ...current[key], report: current[key]?.report ?? saved } }));
      }, (reason) => { if (!cancelled && !freshSucceeded) setCacheNotice(`上次统计读取失败，正在重新读取记录：${String(reason)}`); });
    }
    const controller = new AbortController();
    backend.analysisReport(source, range, JSON.parse(key)[2], controller.signal, (progress) => { if (!cancelled) setProgressText(`正在读取 ${progress.source} · ${progress.current} / ${progress.total} 个来源`); }).then(
      (result) => { freshSucceeded = true; if (!cancelled) { setCacheNotice(result.cache_error ? `本次统计已完成，但无法保存启动缓存：${result.cache_error}` : null); setResponses((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key).slice(-7)), [key]: { report: result } })); } },
      (reason) => { if (!cancelled) setResponses((current) => ({ ...current, [key]: { report: current[key]?.report, error: String(reason) } })); },
    ).finally(() => { if (!cancelled) setLoadingKey(null); });
    return () => { cancelled = true; controller.abort(); };
  }, [source, range, key, refresh]);
  useEffect(() => {
    if (!visible || providerPage || view === 'sources' || typeof document === 'undefined') return;
    const interval = window.setInterval(() => { if (!document.hidden && loadingKey === null) setRefresh((value) => value + 1); }, 60_000);
    return () => window.clearInterval(interval);
  }, [visible, providerPage, view, loadingKey]);
  const sourceLabel = source === 'all' ? '全部可用来源' : catalog?.sources.find((item) => item.name === source)?.display_name ?? source ?? '等待连接';
  const tokens = report?.summaries.reduce((sum, row) => sum + row.summary.tokens.total_tokens, 0) ?? 0;
  const costs = report?.summaries.map((row) => row.summary.cost_usd) ?? [];
  const partialCost = costs.some((cost) => cost === null) || !!report?.errors.length || !!report?.summaries.some((row) => row.summary.api_equivalent_cost_coverage?.cost_is_lower_bound);
  const knownCosts = costs.filter((cost): cost is number => cost !== null);
  const malformedRecords = report?.summaries.reduce((sum, row) => sum + row.summary.parse_error_entries, 0) ?? 0;
  const incompleteData = malformedRecords > 0 || !!report?.errors.length;
  const estimatedCost = report?.summaries.some((row) => row.summary.cost_kind !== 'real' || row.summary.pricing_source !== 'recorded');
  const title = ANALYSIS_VIEWS.find(([value]) => value === view)![1];
  const cacheSources = report?.summaries.filter((row) => row.summary.tokens.cache_hit_rate !== null) ?? [];
  const cacheInput = cacheSources.reduce((sum, row) => sum + Math.max(0, row.summary.tokens.input_tokens) + Math.max(0, row.summary.tokens.cache_creation_tokens) + Math.max(0, row.summary.tokens.cache_read_tokens), 0);
  const cacheRead = cacheSources.reduce((sum, row) => sum + Math.max(0, row.summary.tokens.cache_read_tokens), 0);
  const busy = !providerPage && view !== 'sources' && !report && !error;
  const dark = (workspaceTheme ?? theme).includes('dark');
  const headings: Record<WorkspaceView, [string, string, string]> = {
    overview: ['A LITTLE CLARITY, EVERY DAY', '每一份用量，都心中有数。', '看看你的 AI 工作节奏，以及接下来还能做多少。'],
    quota: ['ROOM FOR YOUR NEXT IDEA', '安心开工，额度一目了然。', '当前订阅窗口独立显示，不受历史用量的日期筛选影响。'],
    usage: ['FOLLOW THE NUMBERS', '每一次投入，都有迹可循。', '从模型、项目和会话，了解消耗的去向。'],
    history: ['FIND YOUR RHYTHM', '让工作节奏，有迹可循。', '按日查看真实用量，保留来源与费用的完整性。'],
    sources: ['YOUR CONNECTED WORKSPACE', '把使用记录，汇在一处。', '读取本地记录，清楚展示每个来源的状态。'],
    settings: ['MAKE IT YOURS', '按照你的习惯，安排工作区。', '管理外观、菜单栏与账户刷新设置。'],
  };
  function changeTheme() { const next = dark ? 'light' : 'dark'; if (onThemeChange) onThemeChange(next); else { setTheme(next); saveTheme(next); } }
  function chooseSource(value: string) { setSource(value); setSearch(''); setSelectedDate(null); setModelChoice('all'); setProjectChoice('all'); }
  async function exportSummary(format: 'json' | 'svg' = 'json') {
    if (!report || exporting) return;
    setExporting(true); setSavedExport(null); setActionError(null);
    try {
      const data = { app: 'QuotaBar', range, since: report.since, until: report.until, timezone: report.timezone, generated_at: report.generated_at, exported_at: new Date().toISOString(), filtered: modelChoice !== 'all' || projectChoice !== 'all', cost_label: `${partialCost ? '≥ ' : estimatedCost ? '≈ ' : ''}${money(knownCosts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : null)}`, source: hideSource ? undefined : sourceLabel, total_tokens: tokens, cost_usd: knownCosts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : null, cost_incomplete: partialCost, cost_estimated: estimatedCost, data_incomplete: incompleteData, malformed_records: malformedRecords, cache_hit_rate: cacheInput > 0 ? cacheRead / cacheInput * 100 : null, note: '本地记录；所选日期范围统计；费用参考不代表订阅账单' };
      const path = await backend.saveAnalysisSummary(data, format);
      setSavedExport(path);
    } catch (reason) { setActionError(`无法保存摘要：${String(reason)}`); setShareOpen(false); }
    finally { setExporting(false); }
  }

  const records = report?.summaries.reduce((sum, row) => sum + row.summary.valid_entries, 0) ?? 0;
  const readySources = catalog?.diagnostics.filter((item) => item.status !== 'missing') ?? [];
  const modelOptions = report?.available_models ?? [];
  const rangeLabel = selectedDate ?? (range === 'custom' ? `${appliedDates.since} — ${appliedDates.until}` : ANALYSIS_RANGES.find(([value]) => value === range)![1]);
  const projectOptions = (report?.available_projects ?? []).map((path) => [path, path.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || path]);
  return <div className={`analysis-app ${dark ? 'analysis-dark' : ''}`}>
    <aside className="analysis-sidebar"><div className="analysis-brand"><b>Q</b><div><strong>QuotaBar</strong><small>YOUR AI WORKSPACE</small></div></div><button className="workspace-account" onClick={() => navigate('sources')}><WorkspaceIcon name="shield" /><span>本地工作区<small>查看记录来源</small></span><span>↗</span></button><small className="analysis-nav-label">工作区</small>
      <nav aria-label="分析导航">{ANALYSIS_VIEWS.filter(([value]) => value !== 'sources' && value !== 'settings').map(([value, label], index) => <button key={value} aria-current={view === value ? 'page' : undefined} onClick={() => navigate(value)}><WorkspaceIcon name={value} />{label}<kbd>{index + 1}</kbd></button>)}</nav>
      <div className="workspace-source-nav"><small className="analysis-nav-label">数据来源 <span>{readySources.length}</span></small>{readySources.slice(0, 3).map((item) => <button key={item.name} aria-pressed={source === item.name} onClick={() => { chooseSource(item.name); navigate('overview'); }}><i style={{ background: sourceColor(item.name) }} />{item.display_name}<span>•</span></button>)}{readySources.length > 3 && <button onClick={() => navigate('sources')}>查看全部来源 ↗</button>}</div>
      <div className="analysis-management"><div className="workspace-local-note"><WorkspaceIcon name="shield" /><div>专注你的工作<small>用量与额度，一处看清。</small></div></div><nav aria-label="管理导航">{ANALYSIS_VIEWS.filter(([value]) => value === 'sources' || value === 'settings').map(([value, label]) => <button key={value} aria-current={view === value ? 'page' : undefined} onClick={() => navigate(value)}><WorkspaceIcon name={value} />{label}</button>)}<button onClick={changeTheme}><WorkspaceIcon name="theme" />{dark ? '切换浅色外观' : '切换深色外观'}</button></nav></div><div className="analysis-local"><span>●</span> 本地记录 · 自动发现来源</div>
    </aside>
    <main><header className="workspace-topbar"><span>工作区 <i>/</i> {title}</span><div><span className="workspace-local-badge">LOCAL WORKSPACE</span><button aria-label="打开菜单栏面板" title="打开菜单栏面板" onClick={() => void backend.openQuotaPopover().catch((reason) => setActionError(`无法打开菜单栏面板：${String(reason)}`))}><WorkspaceIcon name="quota" /></button><button aria-label="切换深浅主题" onClick={changeTheme}><WorkspaceIcon name="theme" /></button></div></header>
    <div className="analysis-content" ref={contentRef}><header className="workspace-page-heading"><div><span className="workspace-eyebrow">{headings[view][0]}</span><h1>{headings[view][1]}</h1><p>{headings[view][2]}</p></div>{!providerPage && view !== 'sources' && <button disabled={!report} onClick={() => { setSavedExport(null); setShareOpen(true); }}><WorkspaceIcon name="share" />分享摘要</button>}</header>
    <div className="analysis-toolbar" hidden={providerPage}>
      <div className="analysis-actions"><label className="analysis-source-select"><WorkspaceIcon name="sources" /><select aria-label="数据来源" value={source ?? ''} onChange={(event) => chooseSource(event.target.value)}><option value="all">全部可用来源</option>{source && source !== 'all' && !catalog?.sources.some((item) => item.name === source) && <option value={source}>{source} · 暂无本地统计</option>}{catalog?.sources.map((item) => <option value={item.name} key={item.name}>{item.display_name}</option>)}</select></label>{view !== 'sources' && <><label className="analysis-source-select"><WorkspaceIcon name="settings" /><select aria-label="筛选模型" title="精确筛选模型，汇总、趋势和明细同步更新" value={modelChoice} disabled={!report} onChange={(event) => { setModelChoice(event.target.value); setSearch(''); }}><option value="all">全部模型</option>{modelChoice !== 'all' && !modelOptions.includes(modelChoice) && <option value={modelChoice}>{modelChoice} · 当前无记录</option>}{modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><label className="analysis-source-select"><WorkspaceIcon name="usage" /><select aria-label="筛选项目" title="精确筛选项目，汇总、趋势和明细同步更新" value={projectChoice} disabled={!report || !projectOptions.length && projectChoice === 'all'} onChange={(event) => { setProjectChoice(event.target.value); setSearch(''); }}><option value="all">全部项目</option>{projectChoice !== 'all' && !projectOptions.some(([path]) => path === projectChoice) && <option value={projectChoice}>{projectChoice} · 当前无记录</option>}{projectOptions.map(([path, name]) => <option key={path} value={path} title={path}>{name}</option>)}</select></label></>}<button aria-label="刷新" onClick={() => { if (!source) window.location.reload(); else setRefresh((value) => value + 1); }}><WorkspaceIcon name="refresh" /></button></div>
      {view !== 'sources' && <div className="analysis-ranges" aria-label="统计周期">{ANALYSIS_RANGES.map(([value, label]) => <button key={value} aria-pressed={range === value && !selectedDate} onClick={() => { setRange(value); setSelectedDate(null); }}>{label}</button>)}<details className="workspace-custom-dates"><summary>自定义</summary><div><label>开始日期<input type="date" aria-label="开始日期" value={customDates.since} onChange={(event) => setCustomDates((value) => ({ ...value, since: event.target.value }))} /></label><label>结束日期<input type="date" aria-label="结束日期" value={customDates.until} min={customDates.since} onChange={(event) => setCustomDates((value) => ({ ...value, until: event.target.value }))} /></label><button disabled={!customDates.since || !customDates.until || customDates.since > customDates.until} onClick={() => { setAppliedDates(customDates); setRange('custom'); setSelectedDate(null); }}>应用日期</button></div></details></div>}
    </div>
      {(catalogError || actionError || error) && <div role="alert" className="analysis-error">{catalogError || actionError || error}</div>}
      {view === 'quota' && <><div className="analysis-list-toolbar"><div><h2>当前订阅窗口</h2><p>各来源独立计算，百分比表示已使用；不受历史日期筛选影响。</p></div>{providerView !== 'all' && <button onClick={() => onProviderView?.('all')}>全部账户</button>}</div>{providerView === 'all' && <WorkspaceQuotas onRefresh={onRefreshProvider} summaries={summaries} windows={quotaWindows} onSelect={(provider) => onProviderView?.(provider)} />}</>}
      <div className="analysis-provider-content" hidden={!providerPage || (view === 'quota' && providerView === 'all')}>{providerContent}</div>
      {report?.errors.map((message) => <p className="analysis-error" role="alert" key={message}>{message}</p>)}
      {providerPage ? null : view === 'sources' ? <section className="analysis-section"><header><h2>本地记录与连接状态</h2><small>{catalog?.sources.length ?? '—'} 个统计来源</small></header>{!catalog && !catalogError && <p role="status">正在发现来源…</p>}{catalog?.diagnostics.map((item) => <article className="analysis-source-row" key={item.name}><div><h3>{item.display_name}</h3><p>{item.detail}</p><small>{item.setup}</small></div><span className={`analysis-status ${item.status}`}>{item.status === 'missing' ? '未发现' : item.status === 'configured' ? '已配置' : '已发现'}</span></article>)}</section> : <>
        {selectedDate && <div className="workspace-day-filter"><span>{selectedDate} · 当天汇总与会话</span><button onClick={() => setSelectedDate(null)}>清除日期选择 ×</button></div>}
        <p className="analysis-scope" hidden={modelChoice === 'all' && projectChoice === 'all'}>当前筛选：{sourceLabel} · {modelChoice === 'all' ? '全部模型' : modelChoice} · {projectChoice === 'all' ? '全部项目' : projectChoice}。汇总、趋势和会话使用相同范围。</p>
        {report && loadingKey === key && <p className="workspace-refresh-status workspace-updating" role="status"><span className="workspace-loading-spinner" aria-hidden="true" />{progressText} · 当前显示上次读取结果（{new Date(report.generated_at).toLocaleString()}）</p>}
        {cacheNotice && <p className="analysis-error" role="alert">{cacheNotice}</p>}
        {report && error && <p className="workspace-refresh-status">刷新失败，当前显示旧数据。</p>}
        {busy && !catalogError && !actionError && <AnalysisLoading progress={progressText} />}
        {report && <>
          <div className="analysis-metrics"><div><small>总 Token</small><strong title={number(tokens)}>{compactNumber(tokens)}</strong><span>{report.summaries.length} 个来源已读取</span></div><div><small>API 等价估算 <button className="workspace-info" aria-label="了解费用参考" onClick={() => setInfo('metrics')}>?</button></small><strong>{knownCosts.length > 0 ? partialCost ? '≥ ' : estimatedCost ? '≈ ' : '' : ''}{money(knownCosts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : null)}</strong><span>参考价值 · 非订阅账单</span></div><div><small>缓存命中率 <button className="workspace-info" aria-label="了解缓存命中率" onClick={() => setInfo('metrics')}>?</button></small><strong>{cacheInput > 0 ? `${(cacheRead / cacheInput * 100).toFixed(1)}%` : '—'}</strong><span>按输入量加权</span></div><div><small>解析记录数 <button className="workspace-info" aria-label="了解解析记录数" onClick={() => setInfo('metrics')}>?</button></small><strong title={number(records)}>{compactNumber(records)}</strong><span>当前周期 · 已成功读取</span></div></div>
          {view === 'usage' ? <><TokenComposition report={report} /><div className="analysis-list-toolbar"><div className="analysis-ranges" aria-label="用量分组"><button aria-pressed={grouping === 'session'} onClick={() => { setGrouping('session'); setSearch(''); }}>会话</button><button aria-pressed={grouping === 'project'} onClick={() => { setGrouping('project'); setSearch(''); }}>项目与会话</button><button aria-pressed={grouping === 'model'} onClick={() => { setGrouping('model'); setSearch(''); }}>模型</button></div><input aria-label="搜索用量" placeholder="搜索名称或来源…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>{grouping === 'session' ? <SessionLedger key={key} report={report} search={search} /> : grouping === 'project' ? <AnalysisProjects key={key} report={report} catalog={catalog} search={search} /> : <AnalysisModels report={report} search={search} />}</> : <>
            <div className={view === 'overview' ? 'workspace-overview-grid' : undefined}><AnalysisHistory report={report} compact={view === 'overview'} selectedDate={selectedDate} onSelectDate={(date) => { setSelectedDate(date); setView('history'); }} />{view === 'overview' && <CurrentQuotaRail summaries={summaries} windows={quotaWindows} onAll={() => navigate('quota')} onSelect={(provider) => { setView('quota'); onProviderView?.(provider); }} />}</div>
            {view === 'history' && <><PeriodComparison key={key} report={report} source={source!} query={query} /><UsageActivity report={report} onDate={(date) => setSelectedDate(date)} /><TokenComposition report={report} /><SessionLedger key={key} report={report} /></>}
            {view === 'overview' && <SessionLedger report={report} compact onExplore={() => { setGrouping('session'); navigate('usage'); }} />}
            {view === 'overview' && <section className="analysis-section"><header><h2>来源与模型</h2><button onClick={() => setView('usage')}>查看项目与会话 →</button></header><div className="analysis-table-wrap"><table><thead><tr><th>来源 / 模型</th><th>Tokens</th><th>费用参考</th><th>依据</th></tr></thead><tbody>{report.summaries.map(({ source: name, summary }) => <tr key={name}><td><button className="analysis-text-button" onClick={() => { setSource(name); setView('usage'); }}>{catalog?.sources.find((item) => item.name === name)?.display_name ?? name}</button><small>{summary.models.map((model) => model.model).join(' · ') || '当前范围没有用量'}</small></td><td>{number(summary.tokens.total_tokens)}</td><td>{analysisCostLabel(summary)}</td><td>{summary.cost_kind}<small>{summary.pricing_source}</small></td></tr>)}</tbody></table></div>{report.summaries.length === 0 && <p className="analysis-empty">没有发现可用记录，请先查看数据来源。</p>}</section>}
          </>}
        </>}
      </>}
    </div><footer className="analysis-footer"><span>{malformedRecords > 0 ? <span className="workspace-quality" role="alert"><button onClick={() => setInfo('quality')}>记录不完整 · {number(malformedRecords)} 条解析失败，查看详情 ↗</button></span> : '● 本地记录 · 用量与额度一处看清'}</span><span>{report ? `最近读取 ${new Date(report.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${report.timezone}` : rangeLabel} · 额度独立于历史用量</span></footer></main>
    <dialog ref={infoDialog} className="workspace-dialog" aria-label="数据说明" onCancel={() => setInfo(null)}><button className="workspace-close" aria-label="关闭数据说明" onClick={() => setInfo(null)}>×</button><span className="workspace-eyebrow">UNDERSTAND YOUR DATA</span><h2>{info === 'quality' ? '记录完整性' : '这些数字，代表什么？'}</h2>{info === 'quality' ? <><p>存在无法解析的记录，用量可能不完整。请检查对应来源记录，修复后刷新。</p>{report?.summaries.filter((row) => row.summary.parse_error_entries > 0).map((row) => <p key={row.source}>{row.source} · {number(row.summary.parse_error_entries)} 条解析失败</p>)}<button className="workspace-primary" onClick={() => { setInfo(null); navigate('sources'); }}>查看数据来源</button></> : <><p>Token 总量直接使用来源报告值，不把推理或缓存子项重复相加。</p><p>API 等价估算表达使用量的参考价值，不是订阅账单。≈ 表示参考价，≥ 表示已知部分；没有价格时显示 —。</p><p>缓存命中率只计算支持缓存统计的来源，并按输入量加权。</p><p>解析记录数为成功读取的用量记录，不是会话数，也不是人的工作时长。</p></>}</dialog>
    <dialog ref={shareDialog} className="workspace-dialog" aria-label="使用摘要" onCancel={() => setShareOpen(false)}><button className="workspace-close" aria-label="关闭摘要" onClick={() => setShareOpen(false)}>×</button><span className="workspace-eyebrow">YOUR USAGE, AT A GLANCE</span><h2>你的使用摘要</h2><p>仅保存到本机，不会自动对外发布；摘要不包含会话标题、项目路径或账户信息。</p><div className="workspace-share-card"><b>QuotaBar</b><strong>{compactNumber(tokens)} <small>Tokens</small></strong><p>{rangeLabel} · 所选日期范围</p>{!hideSource && <p>{sourceLabel}</p>}<p>{partialCost ? '≥ ' : estimatedCost ? '≈ ' : ''}{money(knownCosts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : null)} · 费用参考</p><small>{partialCost || incompleteData ? '数据不完整 · ' : ''}API 等价估算不代表订阅账单</small></div><label><input type="checkbox" checked={hideSource} onChange={(event) => setHideSource(event.target.checked)} /> 隐藏来源名称</label><button className="workspace-primary" disabled={exporting} onClick={() => void exportSummary()}>{exporting ? '正在保存…' : '保存 JSON 到下载文件夹'}</button><button disabled={exporting || !report?.since || !report?.until} onClick={() => void exportSummary('svg')}>保存图片卡片（SVG）</button>{savedExport && <p role="status" className="analysis-path">已保存：{savedExport}</p>}</dialog>
  </div>;
}

interface OverviewPanelProps {
  summaries: ProviderSummary[];
  mostConstrained: QuotaWindowSummary[];
  upcomingResets: QuotaWindowSummary[];
  costRefreshKey: number;
  showCostSummary?: boolean;
  onProviderSelect: (provider: TrayServiceName) => void;
  sections?: PanelSectionVisibility;
}

export default function OverviewPanel({
  summaries,
  mostConstrained,
  upcomingResets,
  costRefreshKey,
  showCostSummary = true,
  onProviderSelect,
  sections = defaultPanelSections(),
}: OverviewPanelProps) {
  const connectedCount = summaries.filter((summary) => summary.connected).length;

  return (
    <div className="overview-panel">
      <ProviderDetailHeader
        service="claude"
        label="Overview"
        status={`${connectedCount} of ${summaries.length} connected`}
        plan="All providers"
        usedPercent={mostConstrained[0]?.usedPercent ?? null}
        usageLabel={mostConstrained[0] ? `${mostConstrained[0].providerLabel} · ${mostConstrained[0].label}` : undefined}
        tone={connectedCount > 0 ? 'online' : 'offline'}
      />

      <div className="section">
        <div className="section-title">Most constrained</div>
        <div className="quota-group">
          {mostConstrained.length > 0 ? mostConstrained.map((window, index) => (
            <button
              type="button"
              className={`quota-card overview-quota-row${index === 0 ? ' primary' : ''}`}
              key={`${window.provider}-${window.label}`}
              onClick={() => onProviderSelect(window.provider)}
              aria-label={`Open ${window.providerLabel}: ${window.label}, ${Math.round(window.usedPercent)}% used`}
            >
              <div className="quota-header">
                <span className="quota-label">{`${window.providerLabel} · ${window.label}`}</span>
                <span className="quota-value">{Math.round(window.usedPercent)}%</span>
              </div>
              <div
                className="progress-bar"
                role="progressbar"
                aria-label={`${window.providerLabel} ${window.label} usage`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={clampProgressValue(window.usedPercent)}
                aria-valuetext={`${Math.round(window.usedPercent)}% used`}
              >
                <div className="progress-fill" style={getProgressStyle(window.usedPercent)} />
              </div>
              {window.resetLabel && <div className="reset-time">Resets in {window.resetLabel}</div>}
            </button>
          )) : (
            <div className="no-data">No provider data</div>
          )}
        </div>
      </div>

      {sections.timeline && <ResetTimeline windows={upcomingResets} />}
      {sections.cost && showCostSummary && (
        <CostSummarySection source={ALL_COST_SOURCES} refreshKey={costRefreshKey} showTrend={sections.trend} />
      )}
    </div>
  );
}

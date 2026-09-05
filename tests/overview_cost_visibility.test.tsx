import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import OverviewPanel, { AnalysisApp, AnalysisSessionName, analysisCostLabel } from '../src/components/OverviewPanel';
import { backend, type AnalysisReport, type AnalysisSession } from '../src/services/backend';
import type { CostDailySeries, CostOverview } from '../src/types/models';
import ActionButtons from '../src/components/ActionButtons';
import { TAB_STORAGE_KEY } from '../src/services/app_state';

const overview: CostOverview = {
  source: 'claude',
  displayName: 'Claude',
  currency: 'USD',
  generatedAt: '2026-08-25T00:00:00Z',
  cached: false,
  ranges: [],
};

const daily: CostDailySeries = {
  source: 'claude',
  currency: 'USD',
  generatedAt: '2026-08-25T00:00:00Z',
  cached: false,
  days: [],
};

function panel(showCostSummary: boolean) {
  return createElement(OverviewPanel, {
    summaries: [],
    mostConstrained: [],
    upcomingResets: [],
    costRefreshKey: 0,
    showCostSummary,
    onProviderSelect: vi.fn(),
    sections: { timeline: false, cost: true, trend: false, tips: false },
  });
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(backend, 'cachedAnalysisReport').mockResolvedValue(null);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.spyOn(backend, 'getCostOverview').mockResolvedValue(overview);
  vi.spyOn(backend, 'getCostDaily').mockResolvedValue(daily);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

describe('Overview cost visibility lifecycle', () => {
  it('mounts cost work only while the popover is visible', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(panel(false));
    });
    expect(backend.getCostOverview).not.toHaveBeenCalled();
    expect(backend.getCostDaily).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      renderer.update(panel(true));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(backend.getCostOverview).toHaveBeenCalledTimes(3);
    expect(backend.getCostDaily).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      renderer.update(panel(false));
    });
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => renderer.unmount());
  });
});

const analysisSession: AnalysisSession = {
  session_id: 'shared-id', first_timestamp: '2026-09-02T00:00:00Z', last_timestamp: '2026-09-02T00:10:00Z',
  metrics: { currency: 'USD', cost: 1, cost_usd: 1, cost_kind: 'api_equivalent', pricing_source: 'cache', api_equivalent_cost_coverage: null, tokens: { reasoning_tokens: 0, reported_total_adjustment: 0, total_tokens: 120, input_tokens: 100, output_tokens: 20, cache_creation_tokens: 0, cache_read_tokens: 0, cache_hit_rate: 0 } },
};
function analysisReport(total: number): AnalysisReport {
  return { since: "2026-09-01", until: "2026-09-02", timezone: "UTC", generated_at: "2026-09-02T10:00:00Z", available_models: [], available_projects: [], hourly: [], summaries: [{ source: 'claude', summary: { ...analysisSession.metrics, tokens: { ...analysisSession.metrics.tokens, total_tokens: total }, valid_entries: 1, parse_error_entries: 0, skipped_entries: 0, models: [] } }], projects: [], history: [], errors: [] };
}

describe('Analysis window', () => {
  it('shows real model rows for sources without project support and preserves raw token totals', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('codex');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [{ name: 'codex', display_name: 'Codex', has_projects: false, has_cache_read: true }], diagnostics: [] });
    const report = analysisReport(120);
    report.summaries[0].source = 'codex';
    report.summaries[0].summary.models = [{ ...analysisSession.metrics, model: 'test-model' }];
    vi.spyOn(backend, 'analysisReport').mockResolvedValue(report);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp)); });
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('用量明细'))!.props.onClick());
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('模型'))!.props.onClick());
    expect(renderer.root.findAllByType('td').some((cell) => cell.children.includes('test-model'))).toBe(true);
    expect(renderer.root.findAllByType('td').some((cell) => cell.children.includes('120'))).toBe(true);
    expect(backend.analysisReport).toHaveBeenLastCalledWith('codex', 'last_30_days', { model: null, project: null, since: null, until: null }, expect.any(AbortSignal), expect.any(Function));
    await act(async () => renderer.root.findByProps({ 'aria-label': '搜索用量' }).props.onChange({ target: { value: 'no match' } }));
    expect(JSON.stringify(renderer.toJSON())).toContain('没有匹配的模型');
    await act(async () => renderer.unmount());
  });
  it('navigates quota and settings inside the workspace while retaining the provider owner', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('all');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [], diagnostics: [] });
    const read = vi.spyOn(backend, 'analysisReport').mockResolvedValue(analysisReport(120));
    const popup = vi.spyOn(backend, 'openQuotaPopover');
    const select = vi.fn();
    const mounted = vi.fn();
    function ProviderOwner() { mounted(); return createElement('div', { 'data-provider-owner': true }, 'Account details'); }
    const content = createElement(ProviderOwner);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp, { providerContent: content, providerView: 'all', onProviderView: select })); });
    const initialReads = read.mock.calls.length;
    const click = (label: string) => renderer.root.findAllByType('button').find((button) => button.children.includes(label))!.props.onClick();
    await act(async () => click('订阅额度'));
    expect(renderer.root.findByType('h1').children).toEqual(['安心开工，额度一目了然。']);
    expect(select).toHaveBeenLastCalledWith('all');
    await act(async () => click('设置'));
    expect(select).toHaveBeenLastCalledWith('settings');
    expect(renderer.root.findByProps({ className: 'analysis-provider-content' }).props.hidden).toBe(false);
    expect(read).toHaveBeenCalledTimes(initialReads);
    expect(popup).not.toHaveBeenCalled();
    expect(mounted).toHaveBeenCalledTimes(1);
    await act(async () => renderer.update(createElement(AnalysisApp, { providerContent: content, providerView: 'codex', onProviderView: select })));
    expect(renderer.root.findByType('h1').children).toEqual(['安心开工，额度一目了然。']);
    await act(async () => renderer.unmount());
  });
  it('opens analysis with the selected tray source and reports launch failures', async () => {
    localStorage.setItem(TAB_STORAGE_KEY, 'codex');
    const open = vi.spyOn(backend, 'openAnalysis').mockRejectedValue(new Error('Window unavailable'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(ActionButtons, { onRefresh: vi.fn(), onDashboard: vi.fn(), onSettings: vi.fn(), onQuit: vi.fn(), loading: false })); });
    await act(async () => renderer.root.findByProps({ className: 'analysis-launch' }).props.onClick());
    expect(open).toHaveBeenCalledWith('codex');
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Window unavailable');
    await act(async () => renderer.unmount());
  });
  it('distinguishes reference prices, lower bounds and unknown costs without rounding tiny usage to zero', () => {
    const metrics = { ...analysisSession.metrics, cost: 0.0006, cost_kind: 'real', pricing_source: 'fallback' };
    expect(analysisCostLabel(metrics)).toContain('≈');
    expect(analysisCostLabel(metrics)).toContain('0.0006');
    expect(analysisCostLabel({ ...metrics, cost: null })).toBe('—');
    expect(analysisCostLabel({ ...metrics, api_equivalent_cost_coverage: { percent: 50, cost_is_lower_bound: true } })).toContain('≥');
    expect(analysisCostLabel({ ...metrics, pricing_source: 'recorded' })).not.toContain('≈');
  });
  it('ignores older range results and never starts provider polling', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('claude');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [{ name: 'claude', display_name: 'Claude Code', has_projects: true, has_cache_read: true }], diagnostics: [] });
    let finishWeek!: (value: AnalysisReport) => void;
    vi.spyOn(backend, 'analysisReport').mockImplementation((_source, range) => range === 'last_30_days'
      ? new Promise((resolve) => { finishWeek = resolve; }) : Promise.resolve(analysisReport(222)));
    const quota = vi.spyOn(backend, 'getQuota');
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp)); });
    await act(async () => { renderer.root.findAllByType('button').find((button) => button.children.includes('今天'))!.props.onClick(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('222');
    await act(async () => finishWeek(analysisReport(999)));
    expect(JSON.stringify(renderer.toJSON())).not.toContain('999');
    expect(backend.getCostOverview).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => renderer.unmount());
  });

  it('opens real recent sessions, filters projects, and preserves missing cache values', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('claude');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [{ name: 'claude', display_name: 'Claude Code', has_projects: true, has_cache_read: true }], diagnostics: [] });
    const report = analysisReport(320);
    report.projects = [{ source_name: 'claude', display_name: 'Claude Code', session_titles_error: null, session_titles: { 'shared-id': { text: '真实来源标题', origin: 'source_title' } }, projects: [
      { project_path: '/work/one', project_name: 'one', session_count: 1, metrics: analysisSession.metrics, sessions: [analysisSession] },
      { project_path: '/work/two', project_name: 'two', session_count: 1, metrics: analysisSession.metrics, sessions: [{ ...analysisSession, session_id: 'other', metrics: { ...analysisSession.metrics, tokens: { ...analysisSession.metrics.tokens, total_tokens: 200, cache_hit_rate: null } } }] },
    ] }];
    vi.spyOn(backend, 'analysisReport').mockResolvedValue(report);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp)); });
    const click = (label: string) => renderer.root.findAllByType('button').find((button) => button.children.includes(label))!.props.onClick();
    await act(async () => click('真实来源标题'));
    const detail = renderer.root.findByProps({ 'aria-label': '会话详情' });
    expect(JSON.stringify(detail.findByType('h3').children)).toContain('真实来源标题');
    expect(detail.findByType('code').children).toEqual(['shared-id']);
    await act(async () => renderer.root.findByProps({ 'aria-label': '关闭会话详情' }).props.onClick());
    await act(async () => click('全部会话 ↗'));
    expect(renderer.root.findByProps({ 'aria-label': '会话排序' })).toBeDefined();
    await act(async () => renderer.root.findByProps({ 'aria-label': '会话排序' }).props.onChange({ target: { value: 'tokens' } }));
    const body = renderer.root.findByType('tbody');
    expect(JSON.stringify(body.findAllByType('tr')[0].findAllByType('td').map((td) => td.children.filter((child) => typeof child === 'string')))).toContain('200');
    expect(body.findAllByType('tr')[0].findAllByType('td')[3].children).toEqual(['—']);
    await act(async () => renderer.root.findByProps({ 'aria-label': '筛选会话项目' }).props.onChange({ target: { value: '/work/one' } }));
    expect(renderer.root.findAllByType('tbody')[0].findAllByType('tr')).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  it('switches workspace theme through its existing owner and drills into a real history day', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('claude');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [], diagnostics: [] });
    const report = analysisReport(120);
    report.history = [{ source_name: 'claude', display_name: 'Claude', currency: 'USD', points: ['2026-09-01', '2026-09-02'].map((date) => ({ ...analysisSession.metrics, date, cost_status: 'known', records: 1 })) }];
    vi.spyOn(backend, 'analysisReport').mockResolvedValue(report);
    const changeTheme = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp, { theme: 'light', onThemeChange: changeTheme })); });
    await act(async () => renderer.root.findByProps({ 'aria-label': '切换深浅主题' }).props.onClick());
    expect(changeTheme).toHaveBeenCalledWith('dark');
    await act(async () => renderer.root.findByProps({ 'aria-label': '2026-09-02 · 120 Tokens' }).props.onClick());
    expect(backend.analysisReport).toHaveBeenLastCalledWith('claude', 'last_30_days', { model: null, project: null, since: '2026-09-02', until: '2026-09-02' }, expect.any(AbortSignal), expect.any(Function));
    expect(renderer.root.findAllByType('tbody')[0].findAllByType('tr')).toHaveLength(1);
    expect(renderer.root.findAllByType('tbody')[0].findAllByType('td')[0].children[0]).toBe('2026-09-02');
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('清除日期选择 ×'))!.props.onClick());
    expect(renderer.root.findAllByType('tbody')[0].findAllByType('tr')).toHaveLength(2);
    await act(async () => renderer.unmount());
  });

  it('saves a private summary through native IPC and reports failed writes', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('claude');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [], diagnostics: [] });
    vi.spyOn(backend, 'analysisReport').mockResolvedValue(analysisReport(120));
    const save = vi.spyOn(backend, 'saveAnalysisSummary').mockResolvedValueOnce('/Downloads/QuotaBar.json').mockRejectedValueOnce(new Error('Disk full'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp)); });
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('分享摘要'))!.props.onClick());
    await act(async () => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
    await act(async () => { renderer.root.findByProps({ className: 'workspace-primary' }).props.onClick(); await Promise.resolve(); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ total_tokens: 120, source: undefined, range: 'last_30_days', data_incomplete: false, malformed_records: 0 }), 'json');
    expect(JSON.stringify(renderer.root.findByProps({ role: 'status' }).children)).toContain('/Downloads/QuotaBar.json');
    await act(async () => { renderer.root.findByProps({ className: 'workspace-primary' }).props.onClick(); await Promise.resolve(); });
    expect(JSON.stringify(renderer.root.findByProps({ role: 'alert' }).children)).toContain('无法保存摘要：Error: Disk full');
    await act(async () => renderer.unmount());
  });

  it('persists names across remounts, isolates sources, restores source metadata', async () => {
    localStorage.setItem('quotabar.session-title:["codex","shared-id"]', 'Codex only');
    const element = createElement(AnalysisSessionName, { source: 'claude', project: 'project', session: analysisSession, original: { text: 'Existing summary', origin: 'source_summary' } });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(element); });
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('改名'))!.props.onClick());
    await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: '手动名称 <b>text</b>' } }));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(element); });
    expect(renderer.root.findByType('h3').children).toEqual(['手动名称 <b>text</b>']);
    expect(renderer.root.findAllByType('b')).toHaveLength(0);
    expect(localStorage.getItem('quotabar.session-title:["codex","shared-id"]')).toBe('Codex only');
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('恢复来源名称'))!.props.onClick());
    expect(renderer.root.findByType('h3').children).toEqual(['Existing summary']);
    expect(localStorage.getItem('quotabar.session-title:["claude","shared-id"]')).toBeNull();
    await act(async () => renderer.unmount());
  });

  it('preserves the original name and draft on storage failure', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisSessionName, { source: 'claude', project: 'project', session: analysisSession, original: { text: 'Original', origin: 'source_title' } })); });
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('改名'))!.props.onClick());
    await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'Unsaved' } }));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(renderer.root.findByType('h3').children).toEqual(['Original']);
    expect(renderer.root.findByType('input').props.value).toBe('Unsaved');
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Storage full');
    await act(async () => renderer.unmount());
  });
});


describe('workspace quota freshness', () => {
  it('shows the most constrained window and the stale-data error beside it', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('all');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [], diagnostics: [] });
    vi.spyOn(backend, 'analysisReport').mockResolvedValue(analysisReport(120));
    const provider = { id: 'cursor' as const, label: 'Cursor', shortLabel: 'Cursor', initials: 'C', accent: '', connected: true, loading: false, usedPercent: 22, statusText: 'Connected', readState: { error: 'Service unavailable', readAt: Date.parse('2026-09-05T06:00:00Z') } };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp, { summaries: [provider], quotaWindows: [{ provider: 'cursor', providerLabel: 'Cursor', label: 'Cursor Models', usedPercent: 22 }, { provider: 'cursor', providerLabel: 'Cursor', label: 'Other Models', usedPercent: 100 }] })); });
    const card = renderer.root.findByProps({ className: 'workspace-quota-mini' });
    expect(JSON.stringify(card.findByType('strong').children)).toContain('100%');
    expect(JSON.stringify(card.findByProps({ role: 'alert' }).children)).toContain('当前显示旧数据');
    expect(JSON.stringify(card.findByProps({ role: 'alert' }).children)).toContain('额度读取失败');
    expect(JSON.stringify(card.findByProps({ role: 'alert' }).children)).not.toContain('Service unavailable');
    expect(card.findAllByType('small').some(node => node.children.join('').includes('最近成功读取'))).toBe(true);
    await act(async () => renderer.unmount());
  });
});

describe('coherent workspace queries', () => {
  it('applies exact model and project filters without changing the page and reuses the report across views', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('codex');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [], diagnostics: [] });
    const read = vi.spyOn(backend, 'analysisReport').mockImplementation(async (_source, _range, query) => ({ ...analysisReport(query.project ? 123 : query.model ? 456 : 999), available_models: ['gpt-5', 'gpt-5-mini'], available_projects: ['/work/app', '/work/app-extra'] }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp)); });
    await act(async () => renderer.root.findByProps({ 'aria-label': '筛选模型' }).props.onChange({ target: { value: 'gpt-5' } }));
    expect(read).toHaveBeenLastCalledWith('codex', 'last_30_days', { model: 'gpt-5', project: null, since: null, until: null }, expect.any(AbortSignal), expect.any(Function));
    expect(renderer.root.findByType('h1').children).toEqual(['每一份用量，都心中有数。']);
    expect(JSON.stringify(renderer.toJSON())).toContain('456');
    await act(async () => renderer.root.findByProps({ 'aria-label': '筛选项目' }).props.onChange({ target: { value: '/work/app' } }));
    expect(read).toHaveBeenLastCalledWith('codex', 'last_30_days', { model: 'gpt-5', project: '/work/app', since: null, until: null }, expect.any(AbortSignal), expect.any(Function));
    expect(JSON.stringify(renderer.toJSON())).toContain('123');
    const count = read.mock.calls.length;
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('用量明细'))!.props.onClick());
    expect(read).toHaveBeenCalledTimes(count);
    expect(renderer.root.findByProps({ 'aria-label': '筛选项目' }).props.value).toBe('/work/app');
    await act(async () => renderer.unmount());
  });

  it('keeps same-scope data during refresh and labels it stale on failure', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend, 'analysisSource').mockResolvedValue('claude');
    vi.spyOn(backend, 'analysisCatalog').mockResolvedValue({ sources: [], diagnostics: [] });
    let reject!: (reason: Error) => void;
    vi.spyOn(backend, 'analysisReport').mockResolvedValueOnce(analysisReport(321)).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AnalysisApp)); });
    await act(async () => renderer.root.findByProps({ 'aria-label': '刷新' }).props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('321');
    expect(JSON.stringify(renderer.toJSON())).toContain('当前显示上次读取结果');
    await act(async () => reject(new Error('Unreadable records')));
    expect(JSON.stringify(renderer.toJSON())).toContain('321');
    expect(JSON.stringify(renderer.toJSON())).toContain('当前显示旧数据');
    expect(JSON.stringify(renderer.toJSON())).toContain('Unreadable records');
    await act(async () => renderer.unmount());
  });
});


describe('startup snapshot display', () => {
  it('paints a saved report before fresh aggregation completes, then replaces it', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend,'analysisSource').mockResolvedValue('all');
    vi.spyOn(backend,'analysisCatalog').mockResolvedValue({sources:[],diagnostics:[]});
    vi.mocked(backend.cachedAnalysisReport).mockResolvedValue(analysisReport(321));
    let finish!: (value:AnalysisReport)=>void;
    vi.spyOn(backend,'analysisReport').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    let renderer!:ReactTestRenderer;
    await act(async()=>{renderer=create(createElement(AnalysisApp));});
    expect(JSON.stringify(renderer.toJSON())).toContain('321');
    expect(JSON.stringify(renderer.toJSON())).toContain('当前显示上次读取结果');
    expect(renderer.root.findAllByProps({className:'workspace-loading'})).toHaveLength(0);
    await act(async()=>finish(analysisReport(654)));
    expect(JSON.stringify(renderer.toJSON())).toContain('654');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('当前显示上次读取结果');
    await act(async()=>renderer.unmount());
  });
  it('never lets a late snapshot overwrite the fresh report', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend,'analysisSource').mockResolvedValue('all');
    vi.spyOn(backend,'analysisCatalog').mockResolvedValue({sources:[],diagnostics:[]});
    let old!: (value:AnalysisReport)=>void;
    vi.mocked(backend.cachedAnalysisReport).mockImplementation(()=>new Promise(resolve=>{old=resolve;}));
    vi.spyOn(backend,'analysisReport').mockResolvedValue(analysisReport(654));
    let renderer!:ReactTestRenderer;
    await act(async()=>{renderer=create(createElement(AnalysisApp));});
    await act(async()=>old(analysisReport(321)));
    expect(JSON.stringify(renderer.toJSON())).toContain('654');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('321');
    await act(async()=>renderer.unmount());
  });

  it('shows a loading skeleton without invented indexing progress when no saved report exists', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(backend,'analysisSource').mockResolvedValue('all');
    vi.spyOn(backend,'analysisCatalog').mockResolvedValue({sources:[],diagnostics:[]});
    vi.spyOn(backend,'analysisReport').mockImplementation(()=>new Promise(()=>{}));
    let renderer!:ReactTestRenderer;
    await act(async()=>{renderer=create(createElement(AnalysisApp));});
    expect(renderer.root.findByProps({className:'workspace-loading'}).props['aria-busy']).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('首次建立索引');
    await act(async()=>renderer.unmount());
  });

});

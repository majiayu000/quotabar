import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type {
  AntigravityData,
  CodexData,
  CodexRateLimits,
  CodexResetCredits,
  CodexWeeklyQuotaData,
  CostDailySeries,
  CostOverview,
  CostSource,
  CursorData,
  GrokData,
  QuotaData,
} from '../types/models';

type TrayService = 'claude' | 'codex' | 'cursor' | 'grok' | 'antigravity';

export type AnalysisRange = 'today' | 'this_week' | 'this_month' | 'last_7_days' | 'last_30_days' | 'custom';
export type AnalysisView = 'overview' | 'usage' | 'history' | 'sources';
export interface AnalysisSource { name: string; display_name: string; has_projects: boolean; has_cache_read: boolean }
export interface AnalysisCatalog {
  sources: AnalysisSource[];
  diagnostics: { name: string; display_name: string; status: 'detected' | 'configured' | 'missing'; files: number; detail: string; setup: string }[];
}
export interface AnalysisMetrics {
  currency: string; cost: number | null; cost_usd: number | null; cost_kind: string; pricing_source: string;
  api_equivalent_cost_coverage: { percent: number; cost_is_lower_bound: boolean } | null;
  tokens: { reasoning_tokens: number; reported_total_adjustment: number; total_tokens: number; input_tokens: number; output_tokens: number; cache_creation_tokens: number; cache_read_tokens: number; cache_hit_rate: number | null };
}
export interface AnalysisTitle { text: string; origin: 'source_title' | 'source_summary' }
export interface AnalysisSession { session_id: string; first_timestamp: string; last_timestamp: string; metrics: AnalysisMetrics }
export interface AnalysisProject { project_path: string; project_name: string; session_count: number; metrics: AnalysisMetrics; sessions: AnalysisSession[] }
export interface AnalysisProgress { requestId: string; source: string; current: number; total: number }
export interface AnalysisQuery { model: string | null; project: string | null; since: string | null; until: string | null }
export interface AnalysisReport {
  cache_error?: string | null;
  since: string | null; until: string | null; timezone: string; generated_at: string;
  available_models: string[]; available_projects: string[];
  hourly: { source_name: string; points: { hour: string; tokens: { total_tokens: number }; records: number }[] }[];
  summaries: { source: string; summary: AnalysisMetrics & { valid_entries: number; parse_error_entries: number; skipped_entries: number; models: (AnalysisMetrics & { model: string })[] } }[];
  projects: { source_name: string; display_name: string; projects: AnalysisProject[]; session_titles: Record<string, AnalysisTitle>; session_titles_error: string | null }[];
  history: { source_name: string; display_name: string; currency: string; points: { date: string; tokens: { total_tokens: number }; cost: number | null; cost_usd: number | null; cost_status: string; cost_kind: string; pricing_source: string; api_equivalent_cost_coverage: AnalysisMetrics['api_equivalent_cost_coverage']; records: number }[] }[];
  errors: string[];
}

export const BACKEND_UNAVAILABLE_MESSAGE =
  'QuotaBar desktop backend is unavailable in browser preview';

export function hasTauriBackend(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function invokeBackend<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriBackend()) {
    return Promise.reject(new Error(BACKEND_UNAVAILABLE_MESSAGE));
  }
  return invoke<T>(command, args);
}

export function normalizeTrayIpcPercentage(percentage: number | null): number | null {
  if (percentage == null) return null;
  if (!Number.isFinite(percentage)) {
    throw new Error('Tray percentage must be finite');
  }
  return Math.min(255, Math.max(0, Math.round(percentage)));
}

let analysisRequestSequence = 0;

export const backend = {
  saveAnalysisSummary(summary: Record<string, unknown>, format: 'json' | 'svg' = 'json') { return invokeBackend<string>('save_analysis_summary', { summary, format }); },
  cachedAnalysisReport(source: string, range: AnalysisRange, query: AnalysisQuery) { return invokeBackend<AnalysisReport | null>('cached_analysis_report', { source, range, query }); },
  analysisCatalog() { return invokeBackend<AnalysisCatalog>('analysis_catalog'); },
  analysisSource() { return invokeBackend<string>('analysis_source'); },
  async analysisReport(source: string, range: AnalysisRange, query: AnalysisQuery, signal?: AbortSignal, onProgress?: (progress: AnalysisProgress) => void) {
    const requestId = `analysis-${Date.now()}-${++analysisRequestSequence}`;
    if (signal?.aborted) return Promise.reject(new Error('Analysis cancelled'));
    const unlisten = onProgress && hasTauriBackend() ? await listen<AnalysisProgress>('analysis-progress', (event) => { if (event.payload.requestId === requestId) onProgress(event.payload); }) : undefined;
    if (signal?.aborted) { unlisten?.(); throw new Error('Analysis cancelled'); }
    const cancel = () => { void invokeBackend<void>('cancel_analysis', { requestId }).catch((reason) => console.error('Unable to cancel usage scan', reason)); };
    signal?.addEventListener('abort', cancel, { once: true });
    return invokeBackend<AnalysisReport>('analysis_report', { source, range, query, requestId }).finally(() => { signal?.removeEventListener('abort', cancel); unlisten?.(); });
  },
  openQuotaPopover() { return invokeBackend<void>('open_quota_popover'); },
  openAnalysis(source: string) {
    return invokeBackend<void>('open_analysis', { source });
  },
  getQuota(manual = false) {
    return invokeBackend<QuotaData>('get_quota', { manual });
  },

  getCodexInfo() {
    return invokeBackend<CodexData>('get_codex_info');
  },

  getCodexRateLimits() {
    return invokeBackend<CodexRateLimits>('get_codex_rate_limits');
  },

  getCodexResetCredits() {
    return invokeBackend<CodexResetCredits>('get_codex_reset_credits');
  },

  getCodexWeeklyQuota() {
    return invokeBackend<CodexWeeklyQuotaData>('get_codex_weekly_quota');
  },

  getCursorInfo() {
    return invokeBackend<CursorData>('get_cursor_info');
  },

  getAntigravityInfo() {
    return invokeBackend<AntigravityData>('get_antigravity_info');
  },

  getGrokInfo() {
    return invokeBackend<GrokData>('get_grok_info');
  },

  getCostOverview(source: CostSource, force = false) {
    return invokeBackend<CostOverview>('get_cost_overview', {
      source,
      currency: 'USD',
      timezone: null,
      force,
    });
  },

  getCostDaily(source: CostSource, days: number, force = false) {
    return invokeBackend<CostDailySeries>('get_cost_daily', {
      source,
      days,
      currency: 'USD',
      timezone: null,
      force,
    });
  },

  openClaudeDashboard() {
    return invokeBackend<void>('open_claude_dashboard');
  },

  openCodexDashboard() {
    return invokeBackend<void>('open_codex_dashboard');
  },

  openCursorDashboard() {
    return invokeBackend<void>('open_cursor_dashboard');
  },

  openAntigravityDashboard() {
    return invokeBackend<void>('open_antigravity_dashboard');
  },

  openGrokDashboard() {
    return invokeBackend<void>('open_grok_dashboard');
  },

  updateTrayIcon(
    service: TrayService,
    percentage: number | null,
    visible: boolean,
    force = false,
    style: 'percent' | 'ring' | 'icon' = 'percent',
  ) {
    return invokeBackend<void>('update_tray_icon', {
      service,
      percentage: normalizeTrayIpcPercentage(percentage),
      visible,
      force,
      style,
    });
  },

  resizeWindow(height: number) {
    return invokeBackend<void>('resize_window', { height });
  },

  setDockVisibility(visible: boolean) {
    return invokeBackend<void>('set_dock_visibility', { visible });
  },

  quitApp() {
    return invokeBackend<void>('quit_app');
  },
};

import { invoke } from '@tauri-apps/api/core';
import type {
  AntigravityData,
  CodexData,
  CodexRateLimits,
  CodexStats,
  CostOverview,
  CostSource,
  CursorData,
  QuotaData,
} from '../types/models';

type TrayService = 'claude' | 'codex' | 'cursor' | 'antigravity';

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

export const backend = {
  getQuota() {
    return invokeBackend<QuotaData>('get_quota');
  },

  getCodexInfo() {
    return invokeBackend<CodexData>('get_codex_info');
  },

  getCodexStats() {
    return invokeBackend<CodexStats>('get_codex_stats');
  },

  getCodexRateLimits() {
    return invokeBackend<CodexRateLimits>('get_codex_rate_limits');
  },

  getCursorInfo() {
    return invokeBackend<CursorData>('get_cursor_info');
  },

  getAntigravityInfo() {
    return invokeBackend<AntigravityData>('get_antigravity_info');
  },

  getCostOverview(source: CostSource, force = false) {
    return invokeBackend<CostOverview>('get_cost_overview', {
      source,
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

  updateTrayIcon(
    service: TrayService,
    percentage: number | null,
    visible: boolean,
    force = false,
  ) {
    return invokeBackend<void>('update_tray_icon', {
      service,
      percentage: percentage == null ? null : Math.round(percentage),
      visible,
      force,
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

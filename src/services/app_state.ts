import type { ThemeName } from '../components/ThemeSelector';
import type { QuotaData } from '../types/models';
import { SERVICES } from './service_meta';
import type { AppTabName } from './provider_summary';
import { getSavedTrayEnabled, saveTrayEnabled, type TrayServiceName } from './tray_visibility';
import type { TrayStyle } from './tray_style';

export const THEME_STORAGE_KEY = 'claude-quota-theme';
export const DOCK_HIDDEN_KEY = 'claude-quota-dock-hidden';
export const TAB_STORAGE_KEY = 'claude-quota-tab';
export const SETTINGS_EXPANDED_KEY = 'claude-quota-settings-expanded';
export const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
export const BACKOFF_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const AUTH_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const TRAY_SERVICE_ACTIVATED_EVENT = 'tray-service-activated';
export const TRAY_GUARD_TOAST_MS = 2000;
export const TRAY_CYCLE_INTERVAL_MS = 15 * 1000;
export const TRAY_GUARD_MESSAGE = 'At least one tray must remain enabled';
export const VALID_TABS = new Set<string>(['all', ...SERVICES]);

export interface TrayServiceActivatedPayload {
  service: TrayServiceName;
}

export type ServiceMap<T> = Record<TrayServiceName, T>;
export type TrayEnabledState = ServiceMap<boolean>;
export type TrayIconRequest = {
  percentage: number | null;
  visible: boolean;
  style: TrayStyle;
};

export function defaultServiceMap<T>(value: T): ServiceMap<T> {
  return SERVICES.reduce((acc, svc) => {
    acc[svc] = value;
    return acc;
  }, {} as ServiceMap<T>);
}

export function isMacOSPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac/i.test(platform);
}

export function getSavedTab(): AppTabName {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (saved && VALID_TABS.has(saved)) {
      return saved as AppTabName;
    }
  } catch {}
  return 'claude';
}

export function getSavedTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && ['light', 'dark', 'claude', 'claude-dark', 'minimal', 'minimal-dark', 'ocean'].includes(saved)) {
      return saved as ThemeName;
    }
  } catch {}
  return 'light';
}

export function getSavedDockHidden(): boolean {
  try {
    return localStorage.getItem(DOCK_HIDDEN_KEY) === 'true';
  } catch {}
  return false;
}

export function getSavedSettingsExpanded(): boolean {
  try {
    return localStorage.getItem(SETTINGS_EXPANDED_KEY) === 'true';
  } catch {}
  return false;
}

export function getInitialTrayEnabledState(): TrayEnabledState {
  const state = defaultServiceMap(false);
  for (const svc of SERVICES) {
    state[svc] = getSavedTrayEnabled(svc);
  }
  if (!SERVICES.some((svc) => state[svc])) {
    saveTrayEnabled('claude', true);
    state.claude = true;
  }
  return state;
}

export function getClaudeTrayUsedPercent(quota: QuotaData | null): number | null {
  if (!quota) return null;

  if (quota.weeklyTotal) {
    return quota.weeklyTotal.percentage;
  }

  const weeklyUsedCandidates = [
    quota.weeklyOpus?.percentage,
    quota.weeklySonnet?.percentage,
    quota.weeklyDesign?.percentage,
    quota.weeklyFable5?.percentage,
  ]
    .filter((value): value is number => typeof value === 'number');
  if (weeklyUsedCandidates.length > 0) {
    return Math.max(...weeklyUsedCandidates);
  }

  if (quota.session) {
    return quota.session.percentage;
  }

  return null;
}

function isClaudeAuthError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes('oauth token') ||
    normalized.includes('re-login') ||
    normalized.includes('login to claude code') ||
    normalized.includes('token expired') ||
    normalized.includes('expired or invalid') ||
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden')
  );
}

export function getClaudeRefreshIntervalMs(error?: string | null): number {
  if (!error) {
    return AUTO_REFRESH_INTERVAL_MS;
  }

  if (error.includes('429')) {
    return BACKOFF_REFRESH_INTERVAL_MS;
  }

  if (isClaudeAuthError(error)) {
    return AUTH_REFRESH_INTERVAL_MS;
  }

  return AUTO_REFRESH_INTERVAL_MS;
}

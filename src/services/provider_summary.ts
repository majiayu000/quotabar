import type { CSSProperties } from 'react';
import type { CodexRateLimits, CursorData, QuotaData, UsageInfo } from '../types/models';
import { SERVICE_META, SERVICES } from './service_meta';
import type { TrayServiceName } from './tray_visibility';
import { formatResetTime, getProgressStyle } from '../utils/quota_format';

export type AppTabName = TrayServiceName | 'overview';
export type AppViewName = AppTabName | 'settings';

export interface ProviderSummary {
  id: TrayServiceName;
  label: string;
  shortLabel: string;
  initials: string;
  accent: string;
  connected: boolean;
  loading: boolean;
  usedPercent: number | null;
  statusText: string;
}

export interface QuotaWindowSummary {
  provider: TrayServiceName;
  providerLabel: string;
  label: string;
  usedPercent: number;
  resetLabel?: string;
  resetAtMs?: number;
}

export function isProviderTab(tab: AppViewName): tab is TrayServiceName {
  return SERVICES.includes(tab as TrayServiceName);
}

export function getProviderStatusText(
  loading: boolean,
  connected: boolean,
  usedPercent: number | null,
): string {
  if (loading) return 'Syncing';
  if (!connected) return 'Offline';
  if (usedPercent == null) return 'Ready';
  return `${Math.round(usedPercent)}% used`;
}

export function buildProviderSummaries(
  connected: Record<TrayServiceName, boolean>,
  loading: Record<TrayServiceName, boolean>,
  usedPercent: Record<TrayServiceName, number | null>,
): ProviderSummary[] {
  return SERVICES.map((id) => {
    const meta = SERVICE_META[id];
    const isLoading = loading[id];
    const isConnected = connected[id];
    const pct = usedPercent[id];
    return {
      id,
      label: meta.label,
      shortLabel: meta.shortLabel,
      initials: meta.initials,
      accent: meta.accent,
      connected: isConnected,
      loading: isLoading,
      usedPercent: pct,
      statusText: getProviderStatusText(isLoading, isConnected, pct),
    };
  });
}

function resetAtMsFromValue(value?: string | number): number | undefined {
  if (!value) return undefined;
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : undefined;
}

function quotaWindow(
  provider: TrayServiceName,
  label: string,
  usage?: UsageInfo,
): QuotaWindowSummary | null {
  if (!usage || typeof usage.percentage !== 'number') return null;
  const resetAtMs = resetAtMsFromValue(usage.resetTime);
  return {
    provider,
    providerLabel: SERVICE_META[provider].label,
    label,
    usedPercent: usage.percentage,
    resetLabel: usage.resetTime ? formatResetTime(usage.resetTime, { expiredLabel: 'soon' }) : undefined,
    resetAtMs,
  };
}

export function buildClaudeQuotaWindows(quota: QuotaData | null): QuotaWindowSummary[] {
  if (!quota) return [];
  return [
    quotaWindow('claude', '5-hour usage', quota.session),
    quotaWindow('claude', '7-day usage', quota.weeklyTotal),
    quotaWindow('claude', 'Opus 7-day', quota.weeklyOpus),
    quotaWindow('claude', 'Sonnet 7-day', quota.weeklySonnet),
    quotaWindow('claude', 'Design 7-day', quota.weeklyDesign),
    quotaWindow('claude', 'Fable 5 7-day', quota.weeklyFable5),
  ].filter((item): item is QuotaWindowSummary => item !== null);
}

function codexWindowLabel(minutes?: number): string {
  if (!minutes) return 'Usage limit';
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    return days === 7 ? 'Weekly limit' : `${days}d limit`;
  }
  if (minutes >= 60) {
    return `${Math.round(minutes / 60)}h limit`;
  }
  return `${minutes}m limit`;
}

export function buildCodexQuotaWindows(rateLimits: CodexRateLimits | null): QuotaWindowSummary[] {
  if (!rateLimits) return [];
  return [rateLimits.primary, rateLimits.secondary]
    .filter((window): window is NonNullable<typeof window> => Boolean(window))
    .map((window) => ({
      provider: 'codex' as const,
      providerLabel: SERVICE_META.codex.label,
      label: codexWindowLabel(window.windowMinutes),
      usedPercent: window.usedPercent,
      resetLabel: window.resetsAt ? formatResetTime(window.resetsAt, { expiredLabel: 'soon' }) : undefined,
      resetAtMs: resetAtMsFromValue(window.resetsAt),
    }));
}

export function buildCursorQuotaWindows(cursorData: CursorData | null): QuotaWindowSummary[] {
  if (!cursorData?.connected || typeof cursorData.percentage !== 'number') return [];
  return [{
    provider: 'cursor',
    providerLabel: SERVICE_META.cursor.label,
    label: 'Fast requests',
    usedPercent: cursorData.percentage,
    resetLabel: cursorData.resetAt ? formatResetTime(cursorData.resetAt, { expiredLabel: 'soon' }) : undefined,
    resetAtMs: resetAtMsFromValue(cursorData.resetAt),
  }];
}

export function sortMostConstrained(windows: QuotaWindowSummary[]): QuotaWindowSummary[] {
  return [...windows].sort((a, b) => b.usedPercent - a.usedPercent);
}

export function sortUpcomingResets(windows: QuotaWindowSummary[], now = Date.now()): QuotaWindowSummary[] {
  return [...windows]
    .filter((window) => typeof window.resetAtMs === 'number' && window.resetAtMs >= now)
    .sort((a, b) => (a.resetAtMs ?? 0) - (b.resetAtMs ?? 0));
}

export function progressStyle(usedPercent: number): CSSProperties {
  return getProgressStyle(usedPercent);
}

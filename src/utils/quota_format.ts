import type { CSSProperties } from 'react';

export function formatPlanType(planType?: string, fallback = 'Unknown'): string {
  if (!planType) return fallback;
  return planType.charAt(0).toUpperCase() + planType.slice(1);
}

interface ResetTimeFormatOptions {
  emptyLabel?: string;
  expiredLabel?: string;
  showZeroHours?: boolean;
}

export function formatResetTime(
  resetAt?: string | number,
  options: ResetTimeFormatOptions = {},
): string {
  const { emptyLabel = '', expiredLabel = 'now', showZeroHours = false } = options;
  if (!resetAt) return emptyLabel;

  try {
    const date = typeof resetAt === 'number'
      ? new Date(resetAt * 1000)
      : new Date(resetAt);
    const diffMs = date.getTime() - Date.now();

    if (!Number.isFinite(diffMs)) return emptyLabel;
    if (diffMs <= 0) return expiredLabel;

    const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
    if (diffMinutes < 60) {
      return showZeroHours ? `0h ${diffMinutes}m` : `${diffMinutes}m`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    const remainingMinutes = diffMinutes % 60;
    if (diffHours < 24) {
      return remainingMinutes > 0 ? `${diffHours}h ${remainingMinutes}m` : `${diffHours}h`;
    }

    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;
    return remainingHours > 0 ? `${diffDays}d ${remainingHours}h` : `${diffDays}d`;
  } catch {
    return emptyLabel;
  }
}

export function getProgressColor(usedPercent: number): string {
  if (usedPercent >= 90) return '#ef4444';
  if (usedPercent >= 75) return '#f59e0b';
  return '#22c55e';
}

export function getProgressStyle(usedPercent: number): CSSProperties {
  const clamped = Math.min(Math.max(usedPercent, 0), 100);
  return {
    '--progress-color': getProgressColor(usedPercent),
    '--progress-scale': String(clamped / 100),
  } as CSSProperties;
}

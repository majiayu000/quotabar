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

function formatShortDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

/**
 * Projects usage rate over a fixed-length quota window.
 * Returns null when there is not enough signal to project
 * (no reset time, window not started, or already expired/full).
 */
export function formatPaceText(
  usedPercent: number,
  resetsAt: string | number | undefined,
  windowMinutes: number | undefined,
  now: number = Date.now(),
): string | null {
  if (!resetsAt || !windowMinutes || windowMinutes <= 0) return null;
  if (!Number.isFinite(usedPercent) || usedPercent <= 0 || usedPercent >= 100) return null;

  // Numeric reset timestamps are unix seconds (same as formatResetTime).
  const resetTime = typeof resetsAt === 'number'
    ? resetsAt * 1000
    : new Date(resetsAt).getTime();
  if (!Number.isFinite(resetTime)) return null;

  const msToReset = resetTime - now;
  if (msToReset <= 0) return null;

  const windowMs = windowMinutes * 60000;
  const elapsedMs = windowMs - msToReset;
  if (elapsedMs <= 0) return null;

  const msToFull = (elapsedMs / usedPercent) * (100 - usedPercent);
  if (msToFull < msToReset) {
    return `At current pace, full in ~${formatShortDuration(msToFull)}`;
  }
  return 'At current pace, window outlasts usage';
}

export function getProgressColor(usedPercent: number): string {
  if (usedPercent >= 80) return '#FF3B30';
  if (usedPercent >= 50) return '#FF9500';
  return '#34C759';
}

export function getProgressStyle(usedPercent: number): CSSProperties {
  const clamped = Math.min(Math.max(usedPercent, 0), 100);
  const color = getProgressColor(usedPercent);
  return {
    width: `${clamped}%`,
    background: `linear-gradient(90deg, ${color}bb, ${color})`,
  } as CSSProperties;
}

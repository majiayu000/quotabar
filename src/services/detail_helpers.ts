import { formatResetTime } from '../utils/quota_format';
import type { CodexResetCredit, CodexResetCredits } from '../types/models';
import type { QuotaWindowSummary } from './provider_summary';

export function getExhaustedWeekTip(
  resetLabel: string,
  bonusCount: number,
): string {
  if (bonusCount > 0) {
    const noun = bonusCount === 1 ? 'bonus reset' : 'bonus resets';
    return `Weekly is used up. Wait until ${resetLabel}, or use ${bonusCount} ${noun}.`;
  }
  return `Weekly is used up. Resets ${resetLabel}.`;
}

export function getHighUsageTip(
  windows: QuotaWindowSummary[],
  threshold = 80,
): string | null {
  const window = [...windows]
    .filter((item) => item.usedPercent >= threshold)
    .sort((a, b) => b.usedPercent - a.usedPercent)[0];

  if (!window) return null;
  const remaining = Math.max(0, Math.round(100 - window.usedPercent));
  const usage = window.usedPercent >= 100
    ? `Limit reached (${Math.round(window.usedPercent)}% used).`
    : `${remaining}% remaining.`;
  const resetAt = window.resetAtMs;
  const prefix = `${window.providerLabel} ${window.label}: ${usage}`;
  if (resetAt == null || !Number.isFinite(resetAt)) {
    return `${prefix} Reset time unavailable; check the provider dashboard.`;
  }
  const untilReset = resetAt - Date.now();
  if (untilReset <= 0) {
    return `${prefix} The reset time has passed; refresh to check your quota.`;
  }
  const advice = untilReset <= 60 * 60 * 1000
    ? 'If you run out, check again after this reset.'
    : 'Pace usage until reset or check another service.';
  return `${prefix} Resets in ${formatResetTime(resetAt / 1000)}. ${advice}`;
}

export function getAvailableResetCredits(
  resetCredits: CodexResetCredits | null,
): CodexResetCredit[] {
  if (!resetCredits?.connected || resetCredits.availableCount <= 0) return [];
  return resetCredits.credits
    .filter((credit) => credit.status === 'available')
    .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''));
}

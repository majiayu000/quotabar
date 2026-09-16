import { t, localizeLabel } from '../i18n';
import { formatResetTime } from '../utils/quota_format';
import type { CodexResetCredit, CodexResetCredits } from '../types/models';
import type { QuotaWindowSummary } from './provider_summary';

export function getExhaustedWeekTip(
  resetLabel: string,
  bonusCount: number,
): string {
  if (bonusCount > 0) {
    const noun = bonusCount === 1 ? t("bonus reset") : t("bonus resets");
    return t("Weekly is used up. Wait until {p0}, or use {p1} {p2}.", { p0: resetLabel, p1: bonusCount, p2: noun });
  }
  return t("Weekly is used up. Resets {p0}.", { p0: resetLabel });
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
    ? t("Limit reached (0% remaining).")
    : t("{p0}% remaining.", { p0: remaining });
  const resetAt = window.resetAtMs;
  const prefix = `${window.providerLabel} ${localizeLabel(window.label)}: ${usage}`;
  if (resetAt == null || !Number.isFinite(resetAt)) {
    return t("{p0} Reset time unavailable; check the provider dashboard.", { p0: prefix });
  }
  const untilReset = resetAt - Date.now();
  if (untilReset <= 0) {
    return t("{p0} The reset time has passed; refresh to check your quota.", { p0: prefix });
  }
  const advice = untilReset <= 60 * 60 * 1000
    ? t("If you run out, check again after this reset.")
    : t("Pace usage until reset or check another service.");
  return t("{p0} Resets in {p1}. {p2}", { p0: prefix, p1: formatResetTime(resetAt / 1000), p2: advice });
}

export function getAvailableResetCredits(
  resetCredits: CodexResetCredits | null,
): CodexResetCredit[] {
  if (!resetCredits?.connected || resetCredits.availableCount <= 0) return [];
  return resetCredits.credits
    .filter((credit) => credit.status === 'available')
    .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''));
}

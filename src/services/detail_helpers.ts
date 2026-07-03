import type { CodexResetCredit, CodexResetCredits } from '../types/models';
import type { QuotaWindowSummary } from './provider_summary';

export function getHighUsageTip(
  windows: QuotaWindowSummary[],
  threshold = 80,
): string | null {
  const window = [...windows]
    .filter((item) => item.usedPercent >= threshold)
    .sort((a, b) => b.usedPercent - a.usedPercent)[0];

  if (!window) return null;
  return `${window.providerLabel} ${window.label} is at ${Math.round(window.usedPercent)}%.`;
}

export function getAvailableResetCredits(
  resetCredits: CodexResetCredits | null,
): CodexResetCredit[] {
  if (!resetCredits?.connected || resetCredits.availableCount <= 0) return [];
  return resetCredits.credits
    .filter((credit) => credit.status === 'available')
    .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''));
}

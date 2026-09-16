import { t, message } from '../i18n';
export interface BonusReadySnapshot {
  exhausted: boolean;
  availableCount: number;
}

export function canReportBonusReady(
  resetCredits: { connected: boolean; availableCount?: number } | null,
  officialWeeklyUsedPercent?: number,
  filteredAvailableCount?: number,
): boolean {
  if (!resetCredits?.connected) return false;
  if (typeof officialWeeklyUsedPercent !== 'number' || !Number.isFinite(officialWeeklyUsedPercent)) {
    return false;
  }
  if (
    typeof resetCredits.availableCount === 'number'
    && resetCredits.availableCount > 0
    && filteredAvailableCount === 0
  ) {
    return false;
  }
  return true;
}

export function bonusReadyEntered(
  prev: BonusReadySnapshot | null,
  next: BonusReadySnapshot,
): boolean {
  if (!prev) return false;
  const nowReady = next.exhausted && next.availableCount > 0;
  const wasReady = prev.exhausted && prev.availableCount > 0;
  return nowReady && !wasReady;
}

export function formatBonusReadyMessage(availableCount: number): string {
  const noun = availableCount === 1 ? t("bonus reset") : t("bonus resets");
  return t("Codex weekly is at 100%. {p0} {p1} available.", { p0: availableCount, p1: noun });
}

export function bonusReadyMessage(availableCount: number) {
  return availableCount === 1
    ? message("Codex weekly is at 100%. {count} bonus reset available.", { count: availableCount })
    : message("Codex weekly is at 100%. {count} bonus resets available.", { count: availableCount });
}

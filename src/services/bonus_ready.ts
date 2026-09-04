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
  const noun = availableCount === 1 ? 'bonus reset' : 'bonus resets';
  return `Codex weekly is at 100%. ${availableCount} ${noun} available.`;
}

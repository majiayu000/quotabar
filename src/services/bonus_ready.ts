export interface BonusReadySnapshot {
  exhausted: boolean;
  availableCount: number;
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

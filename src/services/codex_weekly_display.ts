import type { CodexRateLimitWindow, CodexWeeklyQuota, CodexWeeklyValueEstimate } from '../types/models';

export type DisplayCheck =
  | { ok: true }
  | { ok: false; kind: 'hard' | 'soft'; message: string };

export function isSoftDisplayCheck(
  check: DisplayCheck | null,
): check is { ok: false; kind: 'soft'; message: string } {
  return check != null && !check.ok && check.kind === 'soft';
}

export function isHardDisplayCheck(
  check: DisplayCheck | null,
): check is { ok: false; kind: 'hard'; message: string } {
  return check != null && !check.ok && check.kind === 'hard';
}

export function checkWeeklyValueEstimate(
  estimate: CodexWeeklyValueEstimate,
  official: CodexRateLimitWindow,
): DisplayCheck {
  if (
    !Number.isFinite(estimate.observedCostUsd)
    || estimate.observedCostUsd <= 0
    || !Number.isFinite(estimate.estimatedWeeklyValueUsd)
    || estimate.estimatedWeeklyValueUsd <= 0
    || !Number.isFinite(estimate.observedTokens)
    || estimate.observedTokens <= 0
    || !Number.isFinite(estimate.estimatedWeeklyTokens)
    || estimate.estimatedWeeklyTokens <= 0
  ) {
    return { ok: false, kind: 'hard', message: 'The local weekly value estimate contains invalid totals.' };
  }
  if (Math.abs(estimate.usedPct - official.usedPercent) > 5) {
    return { ok: false, kind: 'hard', message: 'The local weekly value estimate does not match the quota usage.' };
  }
  const estimateObservedAt = Date.parse(estimate.observedAt);
  const now = Date.now();
  if (!Number.isFinite(estimateObservedAt)) {
    return {
      ok: false,
      kind: 'hard',
      message: 'The local weekly value estimate is stale or has an invalid observation time.',
    };
  }
  if (estimateObservedAt > now + 5 * 60 * 1000) {
    return {
      ok: false,
      kind: 'hard',
      message: 'The local weekly value estimate is stale or has an invalid observation time.',
    };
  }
  const estimateReset = Date.parse(estimate.resetsAt);
  const officialReset = (official.resetsAt ?? 0) * 1000;
  if (
    !Number.isFinite(estimateReset)
    || officialReset <= 0
    || Math.abs(estimateReset - officialReset) > 5 * 60 * 1000
  ) {
    return { ok: false, kind: 'hard', message: 'The local weekly value estimate does not match the quota reset.' };
  }
  if (now - estimateObservedAt > 10 * 60 * 1000) {
    return {
      ok: false,
      kind: 'soft',
      message: 'The local weekly value estimate is stale or has an invalid observation time.',
    };
  }
  return { ok: true };
}

export function checkWeeklyQuotaWindow(
  quota: CodexWeeklyQuota,
  official?: CodexRateLimitWindow,
): DisplayCheck {
  if (!official) {
    return { ok: false, kind: 'hard', message: 'The official weekly quota window is unavailable.' };
  }
  if (!Number.isFinite(official.windowMinutes) || (official.windowMinutes ?? 0) <= 0) {
    return { ok: false, kind: 'hard', message: 'The official weekly window length is unavailable.' };
  }
  if (official.windowMinutes !== quota.windowMinutes) {
    return { ok: false, kind: 'hard', message: 'The local pace snapshot does not match the official weekly window.' };
  }
  const officialReset = official.resetsAt;
  if (!Number.isFinite(officialReset) || (officialReset ?? 0) <= 0) {
    return { ok: false, kind: 'hard', message: 'The official weekly reset time is unavailable.' };
  }
  const localReset = Date.parse(quota.resetsAt) / 1000;
  if (!Number.isFinite(localReset) || localReset <= 0) {
    return { ok: false, kind: 'hard', message: 'The local pace snapshot has an invalid reset time.' };
  }
  if (Math.abs(localReset - (officialReset ?? 0)) > 5 * 60) {
    return { ok: false, kind: 'hard', message: 'The local pace snapshot does not match the current official reset.' };
  }
  const observedAt = Date.parse(quota.observedAt);
  const now = Date.now();
  if (!Number.isFinite(observedAt)) {
    return { ok: false, kind: 'hard', message: 'The local pace snapshot has an invalid observation time.' };
  }
  if (observedAt > now + 5 * 60 * 1000) {
    return { ok: false, kind: 'hard', message: 'The local pace snapshot is dated in the future.' };
  }
  if (now - observedAt > 30 * 60 * 1000) {
    return { ok: false, kind: 'soft', message: 'The local pace snapshot is older than 30 minutes.' };
  }
  if (Math.abs(quota.usedPct - official.usedPercent) > 1) {
    return { ok: false, kind: 'hard', message: 'The local pace usage does not match the current official usage.' };
  }
  return { ok: true };
}

export function formatLocalExtrasPaused(observedAtMs: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - observedAtMs) / 60_000));
  return `Local extras paused · Codex CLI has not refreshed in ${minutes}m`;
}

export function formatOfficialUpdatedAt(updatedAtMs: number, now = Date.now()): string {
  const elapsed = now - updatedAtMs;
  if (elapsed < 15_000) return 'Updated just now';
  const minutes = Math.max(1, Math.round(elapsed / 60_000));
  return `Updated ${minutes}m ago`;
}

export function isWeeklyExhausted(usedPercent?: number): boolean {
  return typeof usedPercent === 'number' && Number.isFinite(usedPercent) && usedPercent >= 100;
}

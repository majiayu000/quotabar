import type { GrokValueEstimate } from '../types/models';

const STALE_AFTER_MS = 10 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export function validateGrokValueEstimate(
  estimate: GrokValueEstimate,
  now: number = Date.now(),
): string | null {
  if (
    !Number.isFinite(estimate.observedCostUsd)
    || estimate.observedCostUsd <= 0
    || !Number.isFinite(estimate.estimatedPeriodValueUsd)
    || estimate.estimatedPeriodValueUsd <= 0
    || !Number.isFinite(estimate.observedTokens)
    || estimate.observedTokens <= 0
    || !Number.isFinite(estimate.estimatedPeriodTokens)
    || estimate.estimatedPeriodTokens <= 0
  ) {
    return 'The local Grok pool estimate contains invalid totals.';
  }

  const estimateObservedAt = Date.parse(estimate.observedAt);
  if (
    !Number.isFinite(estimateObservedAt)
    || estimateObservedAt > now + FUTURE_SKEW_MS
    || now - estimateObservedAt > STALE_AFTER_MS
  ) {
    return 'The local Grok pool estimate is stale or has an invalid observation time.';
  }

  return null;
}

export function grokCoverageLabel(estimate: GrokValueEstimate): string | null {
  const percent = estimate.coveragePercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return null;
  }
  if (!estimate.costIsLowerBound && percent >= 99.95) {
    return null;
  }
  if (estimate.costIsLowerBound) {
    return `价格覆盖率 ${percent.toFixed(1)}% · 未标价推理未计入，金额为下限`;
  }
  return `价格覆盖率 ${percent.toFixed(1)}% · 未标价部分按已标价推理外推`;
}

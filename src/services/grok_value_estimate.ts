import type { GrokValueEstimate } from '../types/models';
import { workspaceCopy } from '../utils/quota_format';

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
    return workspaceCopy(
      'The local Grok pool estimate contains invalid totals.',
      '本地 Grok 整池估算的合计无效。',
    );
  }

  const estimateObservedAt = Date.parse(estimate.observedAt);
  if (
    !Number.isFinite(estimateObservedAt)
    || estimateObservedAt > now + FUTURE_SKEW_MS
    || now - estimateObservedAt > STALE_AFTER_MS
  ) {
    return workspaceCopy(
      'The local Grok pool estimate is stale or has an invalid observation time.',
      '本地 Grok 整池估算已过期，或观察时间无效。',
    );
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
    return workspaceCopy(
      `Pricing coverage ${percent.toFixed(1)}% · unpriced inference omitted, amount is a lower bound`,
      `价格覆盖率 ${percent.toFixed(1)}% · 未标价推理未计入，金额为下限`,
    );
  }
  return workspaceCopy(
    `Pricing coverage ${percent.toFixed(1)}% · unpriced share extrapolated from priced inference`,
    `价格覆盖率 ${percent.toFixed(1)}% · 未标价部分按已标价推理外推`,
  );
}

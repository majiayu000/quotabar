import { describe, expect, it } from 'vitest';
import {
  getLocalCapacityUnavailableMessage,
} from '../src/services/codex_weekly_display';

describe('local capacity unavailable copy', () => {
  it('explains a missing snapshot and the next step', () => {
    expect(getLocalCapacityUnavailableMessage(null, null, null)).toBe(
      'No local weekly snapshot yet. Use Codex on this device, then tap Refresh.',
    );
  });

  it('explains a missing Astra conversion when a snapshot exists', () => {
    expect(getLocalCapacityUnavailableMessage({
      observedAt: '2026-09-17T00:00:00Z',
      windowStartedAt: '2026-09-10T00:00:00Z',
      resetsAt: '2026-09-17T00:00:00Z',
      usedPct: 40,
      observedCostUsd: 80,
      estimatedWeeklyValueUsd: 200,
      observedTokens: 360_000_000,
      estimatedWeeklyTokens: 900_000_000,
      astraEquivalentWeeklyTokens: null,
      modelEstimates: [],
    }, { ok: true }, null)).toContain('Local usage is not enough to convert into Astra tokens yet.');
  });

  it('keeps structured pricing failures and a retry path', () => {
    const copy = getLocalCapacityUnavailableMessage(null, null, {
      diagnostic: 'cannot price Codex models',
      unpricedModels: 'gpt-reserve',
    });
    expect(copy).toContain('Weekly value unavailable because prices are missing for gpt-reserve.');
    expect(copy).toContain('tap Refresh.');
  });
});

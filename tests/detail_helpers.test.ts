import { describe, expect, test } from 'vitest';
import { getAvailableResetCredits, getHighUsageTip } from '../src/services/detail_helpers';

describe('detail helpers', () => {
  test('hides smart tips when usage is missing or below threshold', () => {
    expect(getHighUsageTip([])).toBeNull();
    expect(getHighUsageTip([{
      provider: 'codex',
      providerLabel: 'Codex',
      label: 'Weekly limit',
      usedPercent: 79,
    }])).toBeNull();
  });

  test('uses the highest real usage window for smart tips', () => {
    expect(getHighUsageTip([
      { provider: 'claude', providerLabel: 'Claude', label: 'Session', usedPercent: 82 },
      { provider: 'codex', providerLabel: 'Codex', label: 'Weekly limit', usedPercent: 91 },
    ])).toBe('Codex Weekly limit is at 91%.');
  });

  test('filters and sorts available reset credits only', () => {
    expect(getAvailableResetCredits({
      connected: true,
      availableCount: 2,
      credits: [
        { status: 'used', title: 'Used', expiresAt: '2026-07-05T00:00:00Z' },
        { status: 'available', title: 'Later', expiresAt: '2026-07-07T00:00:00Z' },
        { status: 'available', title: 'Sooner', expiresAt: '2026-07-06T00:00:00Z' },
      ],
    }).map((credit) => credit.title)).toEqual(['Sooner', 'Later']);
  });
});

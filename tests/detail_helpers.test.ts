import { afterEach, describe, expect, test, vi } from 'vitest';
import { getAvailableResetCredits, getExhaustedWeekTip, getHighUsageTip } from '../src/services/detail_helpers';

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

  test('uses Claude 80% copy when it is the only high window', () => {
    expect(getHighUsageTip([{
      provider: 'claude',
      providerLabel: 'Claude',
      label: 'Session',
      usedPercent: 80,
    }])).toBe('Claude Session: 20% remaining. Reset time unavailable; check the provider dashboard.');
  });

  test('builds exhausted-week decision copy', () => {
    expect(getExhaustedWeekTip('Mon, Sep 7, 10:27 AM', 1)).toBe(
      'Weekly is used up. Wait until Mon, Sep 7, 10:27 AM, or use 1 bonus reset.',
    );
    expect(getExhaustedWeekTip('Mon, Sep 7, 10:27 AM', 0)).toBe(
      'Weekly is used up. Resets Mon, Sep 7, 10:27 AM.',
    );
  });

  test('uses the highest real usage window for smart tips', () => {
    expect(getHighUsageTip([
      { provider: 'claude', providerLabel: 'Claude', label: 'Session', usedPercent: 82 },
      { provider: 'codex', providerLabel: 'Codex', label: 'Weekly limit', usedPercent: 91 },
    ])).toBe('Codex Weekly limit: 9% remaining. Reset time unavailable; check the provider dashboard.');
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


describe('time-aware quota advice', () => {
  afterEach(() => vi.useRealTimers());
  test('distinguishes an imminent reset from several days of remaining restriction', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
    const window = { provider: 'claude' as const, providerLabel: 'Claude', label: 'Weekly', usedPercent: 80 };
    expect(getHighUsageTip([{ ...window, resetAtMs: Date.now() + 5 * 60_000 }])).toBe(
      'Claude Weekly: 20% remaining. Resets in 5m. If you run out, check again after this reset.',
    );
    expect(getHighUsageTip([{ ...window, resetAtMs: Date.now() + 5 * 86_400_000 }])).toBe(
      'Claude Weekly: 20% remaining. Resets in 5d. Pace usage until reset or check another service.',
    );
  });
  test('does not promise that elapsed resets have restored quota or invent negative remainder', () => {
    expect(getHighUsageTip([{ provider: 'cursor', providerLabel: 'Cursor', label: 'Usage', usedPercent: 120, resetAtMs: Date.now() - 1000 }])).toBe(
      'Cursor Usage: Limit reached (120% used). The reset time has passed; refresh to check your quota.',
    );
  });
});

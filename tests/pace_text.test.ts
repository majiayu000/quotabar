import { describe, expect, test } from 'vitest';
import { formatPaceText } from '../src/utils/quota_format';

const NOW = Date.parse('2026-07-05T12:00:00Z');
const FIVE_HOURS_MIN = 300;

function resetIn(minutes: number): string {
  return new Date(NOW + minutes * 60000).toISOString();
}

describe('formatPaceText', () => {
  test('projects full before reset when burning fast', () => {
    // 2h into a 5h window (reset in 3h), already 62% used
    // → full in ~(120/62)*38 ≈ 74m, before the reset.
    const text = formatPaceText(62, resetIn(180), FIVE_HOURS_MIN, NOW);
    expect(text).toBe('At current pace, full in ~1h 14m');
  });

  test('projects usage at reset when burning slow', () => {
    // 2h elapsed, 20% used → rate 10%/h → +30% over the remaining 3h.
    const text = formatPaceText(20, resetIn(180), FIVE_HOURS_MIN, NOW);
    expect(text).toBe('At current pace, ~50% at reset');
  });

  test('returns null without enough signal', () => {
    expect(formatPaceText(0, resetIn(180), FIVE_HOURS_MIN, NOW)).toBeNull();
    expect(formatPaceText(100, resetIn(180), FIVE_HOURS_MIN, NOW)).toBeNull();
    expect(formatPaceText(50, undefined, FIVE_HOURS_MIN, NOW)).toBeNull();
    expect(formatPaceText(50, resetIn(180), undefined, NOW)).toBeNull();
    expect(formatPaceText(50, resetIn(-10), FIVE_HOURS_MIN, NOW)).toBeNull();
    // reset further out than the window length → window not started yet
    expect(formatPaceText(50, resetIn(400), FIVE_HOURS_MIN, NOW)).toBeNull();
    expect(formatPaceText(50, 'garbage', FIVE_HOURS_MIN, NOW)).toBeNull();
  });
});

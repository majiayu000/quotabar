import { describe, expect, it } from 'vitest';
import { calendarDays, previousPeriod } from '../src/components/UsageExtras';

describe('calendar accounting ranges', () => {
  it('preserves missing dates and leap days rather than compressing the timeline', () => {
    expect(calendarDays('2024-02-28', '2024-03-01')).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(calendarDays('2023-01-01', '2024-03-01')).toHaveLength(366);
    expect(calendarDays(null, null)).toEqual([]);
  });
  it('uses an adjacent period of the same inclusive day count across month boundaries', () => {
    expect(previousPeriod('2024-03-01', '2024-03-03')).toEqual({ since: '2024-02-27', until: '2024-02-29' });
    expect(previousPeriod('2026-01-01', '2026-01-01')).toEqual({ since: '2025-12-31', until: '2025-12-31' });
  });
});

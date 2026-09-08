import { describe, expect, test } from 'vitest';
import {
  AUTO_REFRESH_INTERVAL_MS,
  getClaudeRefreshIntervalMs,
  getClaudeTrayUsedPercent,
  keepClaudeQuotaOnError,
  isStaleTrayPercent,
} from '../src/App';
import { buildClaudeQuotaWindows, sortMostConstrained } from '../src/services/provider_summary';
import type { QuotaData, UsageInfo } from '../src/types/models';

const usage = (percentage: number): UsageInfo => ({
  used: percentage,
  limit: 100,
  percentage,
});

describe('getClaudeTrayUsedPercent', () => {
  test('uses the hottest Claude window, not weeklyTotal', () => {
    const quota: QuotaData = {
      connected: true,
      weeklyTotal: usage(42),
      weeklyDesign: usage(91),
      weeklyFable5: usage(96),
    };

    expect(getClaudeTrayUsedPercent(quota)).toBe(96);
    expect(getClaudeTrayUsedPercent(quota)).toBe(
      sortMostConstrained(buildClaudeQuotaWindows(quota))[0]?.usedPercent,
    );
  });

  test('keeps weeklyTotal when it is the most constrained window', () => {
    expect(getClaudeTrayUsedPercent({
      connected: true,
      session: usage(12),
      weeklyTotal: usage(88),
      weeklyOpus: usage(20),
    })).toBe(88);
  });

  test('lets a hotter 5-hour session beat a cooler weeklyTotal', () => {
    expect(getClaudeTrayUsedPercent({
      connected: true,
      session: usage(99),
      weeklyTotal: usage(42),
    })).toBe(99);
  });

  test('includes Claude Design in weekly bucket fallback', () => {
    expect(getClaudeTrayUsedPercent({
      connected: true,
      session: usage(12),
      weeklyOpus: usage(36),
      weeklyDesign: usage(84),
    })).toBe(84);
  });

  test('includes Fable 5 in weekly bucket fallback', () => {
    expect(getClaudeTrayUsedPercent({
      connected: true,
      session: usage(12),
      weeklyOpus: usage(36),
      weeklyFable5: usage(87),
    })).toBe(87);
  });

  test('falls back to session usage when weekly buckets are missing', () => {
    expect(getClaudeTrayUsedPercent({
      connected: true,
      session: usage(27),
    })).toBe(27);
  });

  test('returns null when no quota window exists', () => {
    const quota: QuotaData = { connected: true };

    expect(getClaudeTrayUsedPercent(null)).toBeNull();
    expect(getClaudeTrayUsedPercent(quota)).toBeNull();
  });
});

describe('getClaudeRefreshIntervalMs', () => {
  test('uses normal polling when Claude quota succeeds', () => {
    expect(getClaudeRefreshIntervalMs(null)).toBe(AUTO_REFRESH_INTERVAL_MS);
  });

  test('stops automatic polling after auth, throttling, or network failure', () => {
    expect(getClaudeRefreshIntervalMs('Claude OAuth token expired or invalid. Please re-login.')).toBeNull();
    expect(getClaudeRefreshIntervalMs('API error: 429 Too Many Requests')).toBeNull();
    expect(getClaudeRefreshIntervalMs('Network error')).toBeNull();
  });

});

describe('keepClaudeQuotaOnError', () => {
  test('keeps connected stale snapshots even when an error is present', () => {
    expect(keepClaudeQuotaOnError({
      connected: true,
      error: 'Network error: connection reset',
    })).toBe(true);
  });

  test('keeps prior quota for 429 even when disconnected', () => {
    expect(keepClaudeQuotaOnError({
      connected: false,
      error: 'API error: 429 Too Many Requests',
    })).toBe(true);
  });

  test('clears quota for disconnected non-429 errors', () => {
    expect(keepClaudeQuotaOnError({
      connected: false,
      error: 'API error: 401 Unauthorized',
    })).toBe(false);
  });
});

describe('isStaleTrayPercent', () => {
  test('marks a retained percent with an error as last known', () => {
    expect(isStaleTrayPercent('API error: 429 Too Many Requests', 42)).toBe(true);
    expect(isStaleTrayPercent(null, 42)).toBe(false);
    expect(isStaleTrayPercent('API error: 429 Too Many Requests', null)).toBe(false);
  });
});

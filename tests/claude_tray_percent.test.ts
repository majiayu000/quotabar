import { describe, expect, test } from 'vitest';
import {
  AUTO_REFRESH_INTERVAL_MS,
  getClaudeRefreshIntervalMs,
  getClaudeTrayUsedPercent,
  keepClaudeQuotaOnError,
} from '../src/App';
import type { QuotaData, UsageInfo } from '../src/types/models';

const usage = (percentage: number): UsageInfo => ({
  used: percentage,
  limit: 100,
  percentage,
});

describe('getClaudeTrayUsedPercent', () => {
  test('uses weekly total before individual weekly buckets', () => {
    expect(getClaudeTrayUsedPercent({
      connected: true,
      weeklyTotal: usage(42),
      weeklyDesign: usage(91),
      weeklyFable5: usage(96),
    })).toBe(42);
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

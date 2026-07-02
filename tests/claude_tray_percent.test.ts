import { describe, expect, test } from 'vitest';
import {
  AUTH_REFRESH_INTERVAL_MS,
  AUTO_REFRESH_INTERVAL_MS,
  BACKOFF_REFRESH_INTERVAL_MS,
  getClaudeRefreshIntervalMs,
  getClaudeTrayUsedPercent,
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

  test('backs off briefly for rate limits', () => {
    expect(getClaudeRefreshIntervalMs('API error: 429 Too Many Requests')).toBe(
      BACKOFF_REFRESH_INTERVAL_MS,
    );
  });

  test('backs off to hourly polling for Claude auth failures', () => {
    expect(getClaudeRefreshIntervalMs(
      'Claude OAuth token expired or invalid. Please re-login to Claude Code, then click Refresh.',
    )).toBe(AUTH_REFRESH_INTERVAL_MS);
    expect(getClaudeRefreshIntervalMs('API error: 401 Unauthorized')).toBe(AUTH_REFRESH_INTERVAL_MS);
  });
});

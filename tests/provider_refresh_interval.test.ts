import { describe, expect, test } from 'vitest';
import {
  AUTO_REFRESH_INTERVAL_MS,
  BACKGROUND_REFRESH_INTERVAL_MS,
  providerRefreshIntervalMs,
} from '../src/services/app_state';

describe('providerRefreshIntervalMs', () => {
  test('keeps tray-backed providers on the live poll while the popover is hidden', () => {
    expect(providerRefreshIntervalMs(false, true)).toBe(AUTO_REFRESH_INTERVAL_MS);
  });

  test('slows down only when the popover and tray are both hidden', () => {
    expect(providerRefreshIntervalMs(false, false)).toBe(BACKGROUND_REFRESH_INTERVAL_MS);
  });

  test('uses the live poll while the popover is visible', () => {
    expect(providerRefreshIntervalMs(true, false)).toBe(AUTO_REFRESH_INTERVAL_MS);
  });
});

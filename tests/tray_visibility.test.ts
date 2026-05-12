import { describe, expect, test } from 'vitest';
import { shouldShowTray } from '../src/services/tray_visibility';

describe('shouldShowTray', () => {
  test('shows tray whenever it is enabled', () => {
    expect(shouldShowTray(true, true)).toBe(true);
    expect(shouldShowTray(true, false)).toBe(true);
    expect(shouldShowTray(false, true)).toBe(false);
    expect(shouldShowTray(false, false)).toBe(false);
  });
});

import { describe, expect, test } from 'vitest';
import { resolveTrayVisible, shouldShowTray } from '../src/services/tray_visibility';
import type { TrayServiceName } from '../src/services/tray_visibility';

describe('shouldShowTray', () => {
  test('shows tray whenever it is enabled', () => {
    expect(shouldShowTray(true, true)).toBe(true);
    expect(shouldShowTray(true, false)).toBe(true);
    expect(shouldShowTray(false, true)).toBe(false);
    expect(shouldShowTray(false, false)).toBe(false);
  });
});

describe('resolveTrayVisible', () => {
  const enabled: TrayServiceName[] = ['codex', 'grok'];

  test('keeps every enabled provider visible when cycle is off', () => {
    expect(resolveTrayVisible('codex', enabled, false, 0)).toBe(true);
    expect(resolveTrayVisible('grok', enabled, false, 0)).toBe(true);
    expect(resolveTrayVisible('claude', enabled, false, 0)).toBe(false);
  });

  test('cycle mode shows only one candidate at a time', () => {
    expect(resolveTrayVisible('codex', enabled, true, 0)).toBe(true);
    expect(resolveTrayVisible('grok', enabled, true, 0)).toBe(false);
    expect(resolveTrayVisible('codex', enabled, true, 1)).toBe(false);
    expect(resolveTrayVisible('grok', enabled, true, 1)).toBe(true);
  });

  test('a single candidate stays visible even when cycle is on', () => {
    expect(resolveTrayVisible('codex', ['codex'], true, 4)).toBe(true);
  });
});

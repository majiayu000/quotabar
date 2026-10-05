import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTrayEntries } from '../src/components/TrayToggles';
import { defaultServiceMap, getInitialTrayEnabledState, getSavedTab } from '../src/services/app_state';
import { getSavedProviderFavorites } from '../src/services/provider_favorites';
import { ALL_SERVICES, SERVICES, SERVICE_META } from '../src/services/service_meta';
import { subscribeStorageReadFailures } from '../src/services/storage';
import { defaultSwitcherVisibility, getSavedSwitcherVisibility } from '../src/services/switcher_providers';

let values: Map<string, string>;
let readFailures: number;
let unsubscribe: () => void;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  readFailures = 0;
  unsubscribe = subscribeStorageReadFailures(() => { readFailures += 1; });
});

afterEach(() => {
  unsubscribe();
  vi.unstubAllGlobals();
});

describe('hidden Antigravity provider', () => {
  it('stays in code but is absent from every default user-facing list', () => {
    expect(SERVICE_META.antigravity.hidden).toBe(true);
    expect(ALL_SERVICES).toContain('antigravity');
    expect(SERVICES).not.toContain('antigravity');
    expect(defaultSwitcherVisibility().antigravity).toBe(false);
    expect(defaultServiceMap(false)).toHaveProperty('antigravity', false);
    const entries = buildTrayEntries(defaultServiceMap(true), defaultServiceMap(false));
    expect(entries.map((entry) => entry.service)).toEqual(['claude', 'codex', 'cursor', 'grok']);
  });

  it('ignores a stale saved Antigravity favorite without reporting corrupt storage', () => {
    values.set('quotabar-provider-favorites', '["antigravity","codex"]');
    expect(getSavedProviderFavorites()).toEqual(['codex']);
    expect(readFailures).toBe(0);
  });

  it('falls back to detection when the saved switcher only kept Antigravity', () => {
    values.set('claude-quota-switcher-providers', JSON.stringify({
      claude: false, codex: false, cursor: false, grok: false, antigravity: true,
    }));
    expect(getSavedSwitcherVisibility()).toBeNull();
    expect(readFailures).toBe(0);
  });

  it('opens Overview instead of a saved Antigravity tab', () => {
    values.set('claude-quota-tab', 'antigravity');
    expect(getSavedTab()).toBe('all');
    expect(readFailures).toBe(0);
  });

  it('keeps one visible tray when the only saved tray was Antigravity', () => {
    for (const service of SERVICES) values.set(`${service}-tray-enabled`, 'false');
    values.set('antigravity-tray-enabled', 'true');
    const state = getInitialTrayEnabledState();
    expect(state.claude).toBe(true);
    expect(SERVICES.some((service) => state[service])).toBe(true);
  });
});

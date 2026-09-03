import { describe, expect, test } from 'vitest';
import { matchProviderInEventText, planProviderPreset, planRevealProviderPanel } from '../src/services/provider_presets';
import { defaultSwitcherVisibility } from '../src/services/switcher_providers';
import type { TrayServiceName } from '../src/services/tray_visibility';

const allTrays: Record<TrayServiceName, boolean> = {
  claude: true,
  codex: true,
  cursor: true,
  grok: true,
  antigravity: false,
};

describe('planProviderPreset', () => {
  test('All opens every panel and leaves trays unchanged', () => {
    const currentSwitcher = {
      ...defaultSwitcherVisibility(),
      claude: false,
      cursor: false,
      grok: false,
      antigravity: false,
    };
    const currentTrays = { ...allTrays, claude: false, cursor: false, grok: false };
    const plan = planProviderPreset(currentSwitcher, currentTrays, 'all');

    expect(plan.switcher).toEqual({
      claude: true,
      codex: true,
      cursor: true,
      grok: true,
      antigravity: true,
    });
    expect(plan.trays).toEqual(currentTrays);
  });

  test('Codex only isolates the panel and turns the Codex tray on', () => {
    const plan = planProviderPreset(defaultSwitcherVisibility(), {
      ...allTrays,
      codex: false,
    }, 'codex');

    expect(plan.switcher).toEqual({
      claude: false,
      codex: true,
      cursor: false,
      grok: false,
      antigravity: false,
    });
    expect(plan.trays).toEqual({
      claude: true,
      codex: true,
      cursor: true,
      grok: true,
      antigravity: false,
    });
  });

  test('never produces zero trays when only another tray was enabled', () => {
    const plan = planProviderPreset(defaultSwitcherVisibility(), {
      claude: false,
      codex: false,
      cursor: true,
      grok: false,
      antigravity: false,
    }, 'codex');

    expect(plan.trays.codex).toBe(true);
    expect(plan.trays.cursor).toBe(true);
    expect(Object.values(plan.trays).filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });
});

describe('planRevealProviderPanel', () => {
  test('turns a hidden panel on without hiding the others', () => {
    const isolated = planProviderPreset(defaultSwitcherVisibility(), allTrays, 'codex').switcher;
    const revealed = planRevealProviderPanel(isolated, 'claude');

    expect(revealed).toEqual({
      claude: true,
      codex: true,
      cursor: false,
      grok: false,
      antigravity: false,
    });
  });

  test('returns the same map when the panel is already visible', () => {
    const current = defaultSwitcherVisibility();
    expect(planRevealProviderPanel(current, 'codex')).toBe(current);
  });
});

describe('matchProviderInEventText', () => {
  test('matches the provider label', () => {
    expect(matchProviderInEventText('Codex usage crossed 95%')).toBe('codex');
    expect(matchProviderInEventText('Claude connected')).toBe('claude');
  });

  test('leaves unlabeled events unmatched', () => {
    expect(matchProviderInEventText('Failed to persist local setting.')).toBeNull();
  });
});

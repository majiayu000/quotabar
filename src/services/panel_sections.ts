import { readStorageValue, writeStorageItem } from './storage';

export type PanelSectionKey = 'timeline' | 'cost' | 'trend' | 'tips';

export type PanelSectionVisibility = Record<PanelSectionKey, boolean>;

export const PANEL_SECTION_ORDER: PanelSectionKey[] = ['timeline', 'cost', 'trend', 'tips'];

export const PANEL_SECTION_LABELS: Record<PanelSectionKey, string> = {
  timeline: 'Reset timeline',
  cost: 'Local cost',
  trend: 'Usage trend',
  tips: 'Smart tips',
};

const STORAGE_KEY = 'claude-quota-panel-sections';

export function defaultPanelSections(): PanelSectionVisibility {
  return { timeline: true, cost: true, trend: true, tips: true };
}

export function getSavedPanelSections(): PanelSectionVisibility {
  const defaults = defaultPanelSections();
  const result = readStorageValue(STORAGE_KEY, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid saved panel sections');
    }
    for (const key of PANEL_SECTION_ORDER) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') throw new Error('Invalid saved panel section value');
      defaults[key] = value;
    }
    return defaults;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : defaultPanelSections();
}

export function savePanelSections(sections: PanelSectionVisibility): boolean {
  return writeStorageItem(STORAGE_KEY, JSON.stringify(sections), {
    preserveSessionValue: true,
    notifyUser: true,
  });
}

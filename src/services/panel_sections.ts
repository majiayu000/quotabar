export type PanelSectionKey = 'timeline' | 'cost' | 'trend' | 'tips' | 'quick';

export type PanelSectionVisibility = Record<PanelSectionKey, boolean>;

export const PANEL_SECTION_ORDER: PanelSectionKey[] = ['timeline', 'cost', 'trend', 'tips', 'quick'];

export const PANEL_SECTION_LABELS: Record<PanelSectionKey, string> = {
  timeline: 'Reset timeline',
  cost: 'Local cost',
  trend: 'Usage trend',
  tips: 'Smart tips',
  quick: 'Quick actions',
};

const STORAGE_KEY = 'claude-quota-panel-sections';

export function defaultPanelSections(): PanelSectionVisibility {
  return { timeline: true, cost: true, trend: true, tips: true, quick: true };
}

export function getSavedPanelSections(): PanelSectionVisibility {
  const defaults = defaultPanelSections();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    for (const key of PANEL_SECTION_ORDER) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') {
        defaults[key] = value;
      }
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function savePanelSections(sections: PanelSectionVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
  } catch {}
}

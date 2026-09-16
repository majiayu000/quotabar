import { useLocale } from '../i18n/react';
import { t } from '../i18n';
export type ThemeName = 'light' | 'dark' | 'claude' | 'claude-dark' | 'minimal' | 'minimal-dark' | 'ocean';

interface Theme {
  id: ThemeName;
  name: string;
  shortName: string;
}

const themes: () => Theme[] = () => ([
  { id: 'light', name: t("Light"), shortName: t("Light") },
  { id: 'dark', name: t("Dark"), shortName: t("Dark") },
  { id: 'claude', name: 'Claude', shortName: 'Claude' },
  { id: 'claude-dark', name: t("Claude Dark"), shortName: t("Claude Dark") },
  { id: 'minimal', name: t("Minimal"), shortName: t("Minimal") },
  { id: 'minimal-dark', name: t("Minimal Dark"), shortName: t("Minimal Dark") },
  { id: 'ocean', name: t("Ocean"), shortName: t("Ocean") },
]);

interface ThemeSelectorProps {
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
}

export default function ThemeSelector({ currentTheme, onThemeChange }: ThemeSelectorProps) {
  useLocale();
  return (
    <div className="theme-selector">
      {themes().map((theme) => (
        <button
          type="button"
          key={theme.id}
          className={`theme-btn ${currentTheme === theme.id ? 'active' : ''}`}
          data-theme={theme.id}
          onClick={() => onThemeChange(theme.id)}
          title={theme.name}
          aria-label={t("Switch to {p0} theme", { p0: theme.name })}
          aria-pressed={currentTheme === theme.id}
        >
          <span className="theme-swatch" aria-hidden="true" />
          <span className="theme-option-label">{theme.shortName}</span>
        </button>
      ))}
    </div>
  );
}

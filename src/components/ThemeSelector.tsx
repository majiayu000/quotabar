export type ThemeName = 'light' | 'dark' | 'claude' | 'claude-dark' | 'minimal' | 'minimal-dark' | 'ocean';

interface Theme {
  id: ThemeName;
  name: string;
  shortName: string;
}

const themes: Theme[] = [
  { id: 'light', name: 'Light', shortName: 'Light' },
  { id: 'dark', name: 'Dark', shortName: 'Dark' },
  { id: 'claude', name: 'Claude', shortName: 'Claude' },
  { id: 'claude-dark', name: 'Claude Dark', shortName: 'C. Dark' },
  { id: 'minimal', name: 'Minimal', shortName: 'Minimal' },
  { id: 'minimal-dark', name: 'Minimal Dark', shortName: 'M. Dark' },
  { id: 'ocean', name: 'Ocean', shortName: 'Ocean' },
];

interface ThemeSelectorProps {
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
}

export default function ThemeSelector({ currentTheme, onThemeChange }: ThemeSelectorProps) {
  return (
    <div className="theme-selector">
      {themes.map((theme) => (
        <button
          type="button"
          key={theme.id}
          className={`theme-btn ${currentTheme === theme.id ? 'active' : ''}`}
          data-theme={theme.id}
          onClick={() => onThemeChange(theme.id)}
          title={theme.name}
          aria-label={`Switch to ${theme.name} theme`}
          aria-pressed={currentTheme === theme.id}
        >
          <span className="theme-swatch" aria-hidden="true" />
          <span className="theme-option-label">{theme.shortName}</span>
        </button>
      ))}
    </div>
  );
}

export type ThemeName = 'light' | 'dark' | 'claude' | 'claude-dark' | 'minimal' | 'minimal-dark' | 'ocean';

interface Theme {
  id: ThemeName;
  name: string;
  shortName: string;
}

const themes: Theme[] = [
  { id: 'light', name: '浅色', shortName: '浅色' },
  { id: 'dark', name: '深色', shortName: '深色' },
  { id: 'claude', name: 'Claude', shortName: 'Claude' },
  { id: 'claude-dark', name: 'Claude Dark', shortName: 'Claude 深色' },
  { id: 'minimal', name: '极简', shortName: '极简' },
  { id: 'minimal-dark', name: 'Minimal Dark', shortName: '极简深色' },
  { id: 'ocean', name: '海洋', shortName: '海洋' },
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

import ThemeSelector, { type ThemeName } from './ThemeSelector';
import TrayToggles, { type TrayToggleEntry } from './TrayToggles';
import type { TrayServiceName } from '../services/tray_visibility';

interface SettingsViewProps {
  isMacOS: boolean;
  theme: ThemeName;
  dockHidden: boolean;
  trayEntries: TrayToggleEntry[];
  onThemeChange: (theme: ThemeName) => void;
  onDockToggle: () => void;
  onTrayToggle: (service: TrayServiceName) => void;
}

export default function SettingsView({
  isMacOS,
  theme,
  dockHidden,
  trayEntries,
  onThemeChange,
  onDockToggle,
  onTrayToggle,
}: SettingsViewProps) {
  return (
    <div className="settings-view" aria-label="Settings">
      <div className="settings-view-header">
        <div>
          <div className="overview-kicker">Settings</div>
          <h1>Controls</h1>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <span className="settings-title">Appearance</span>
        </div>
        <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
        {isMacOS && (
          <label className="dock-toggle settings-dock-toggle">
            <span className="toggle-label">Hide Dock</span>
            <input
              type="checkbox"
              checked={dockHidden}
              onChange={onDockToggle}
            />
          </label>
        )}
      </div>

      <div className="settings-card">
        <TrayToggles entries={trayEntries} onToggle={onTrayToggle} />
      </div>
    </div>
  );
}

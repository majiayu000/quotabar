import { useState } from 'react';
import ThemeSelector, { type ThemeName } from './ThemeSelector';
import TrayToggles, { type TrayToggleEntry } from './TrayToggles';
import type { TrayServiceName } from '../services/tray_visibility';
import {
  BUDGET_SOURCES,
  getSavedMonthlyBudgets,
  saveMonthlyBudgets,
  type MonthlyBudgets,
} from '../services/budget';
import { SERVICE_META } from '../services/service_meta';
import { TRAY_STYLE_OPTIONS, type TrayStyle } from '../services/tray_style';
import { formatEventTime, type AppEvent } from '../services/event_log';
import {
  NOTIFICATION_ROWS,
  type NotificationKey,
  type NotificationSettings,
} from '../services/notifications';
import type { CostSource } from '../types/models';
import {
  PANEL_SECTION_LABELS,
  PANEL_SECTION_ORDER,
  type PanelSectionKey,
  type PanelSectionVisibility,
} from '../services/panel_sections';

interface SettingsViewProps {
  isMacOS: boolean;
  theme: ThemeName;
  dockHidden: boolean;
  trayEntries: TrayToggleEntry[];
  panelSections: PanelSectionVisibility;
  trayStyle: TrayStyle;
  trayCycle: boolean;
  events: AppEvent[];
  notificationSettings: NotificationSettings;
  onClose: () => void;
  onThemeChange: (theme: ThemeName) => void;
  onDockToggle: () => void;
  onTrayToggle: (service: TrayServiceName) => void;
  onPanelSectionToggle: (key: PanelSectionKey) => void;
  onTrayStyleChange: (style: TrayStyle) => void;
  onTrayCycleToggle: () => void;
  onNotificationToggle: (key: NotificationKey) => void;
}

export default function SettingsView({
  isMacOS,
  theme,
  dockHidden,
  trayEntries,
  panelSections,
  trayStyle,
  trayCycle,
  events,
  notificationSettings,
  onClose,
  onThemeChange,
  onDockToggle,
  onTrayToggle,
  onPanelSectionToggle,
  onTrayStyleChange,
  onTrayCycleToggle,
  onNotificationToggle,
}: SettingsViewProps) {
  const [budgets, setBudgets] = useState<MonthlyBudgets>(getSavedMonthlyBudgets);

  const handleBudgetChange = (source: CostSource, raw: string) => {
    setBudgets((prev) => {
      const next = { ...prev };
      const value = Number(raw);
      if (!raw.trim() || !Number.isFinite(value) || value <= 0) {
        delete next[source];
      } else {
        next[source] = value;
      }
      saveMonthlyBudgets(next);
      return next;
    });
  };

  return (
    <div className="settings-view" aria-label="Settings">
      <div className="settings-view-header">
        <button
          type="button"
          className="settings-back-btn"
          onClick={onClose}
          aria-label="Back to provider view"
        >
          ‹
        </button>
        <div>
          <div className="overview-kicker">Settings</div>
          <h1>Controls</h1>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-section-title">Appearance</div>
        <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
      </div>

      <div className="settings-block">
        <div className="settings-section-title">Menu bar style</div>
        <div className="settings-seg">
          {TRAY_STYLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`settings-seg-btn ${trayStyle === option.id ? 'active' : ''}`}
              onClick={() => onTrayStyleChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="settings-line">
          <span>Cycle one icon through providers</span>
          <button
            type="button"
            role="switch"
            aria-checked={trayCycle}
            aria-label="Cycle one icon through providers"
            className={`target-switch ${trayCycle ? 'on' : ''}`}
            onClick={onTrayCycleToggle}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-section-title">Panel sections</div>
        {PANEL_SECTION_ORDER.map((key) => (
          <label className="settings-line" key={key}>
            <span>{PANEL_SECTION_LABELS[key]}</span>
            <input
              className="native-switch-input"
              type="checkbox"
              checked={panelSections[key]}
              onChange={() => onPanelSectionToggle(key)}
            />
            <span className={`target-switch ${panelSections[key] ? 'on' : ''}`}><span /></span>
          </label>
        ))}
      </div>

      <div className="settings-block">
        <div className="settings-section-title">Monthly budgets</div>
        {BUDGET_SOURCES.map((source) => (
          <label className="settings-line" key={source}>
            <span>{SERVICE_META[source].label}</span>
            <span className="budget-input-wrap">
              $
              <input
                className="budget-input"
                type="number"
                min="0"
                step="1"
                placeholder="none"
                value={budgets[source] ?? ''}
                onChange={(event) => handleBudgetChange(source, event.target.value)}
                aria-label={`${SERVICE_META[source].label} monthly budget in USD`}
              />
            </span>
          </label>
        ))}
        <div className="settings-hint">Shown as a budget bar in the Local cost section.</div>
      </div>

      <div className="settings-block">
        <div className="settings-section-title">Notifications</div>
        {NOTIFICATION_ROWS.map(({ key, label }) => (
          <label className="settings-line" key={key}>
            <span>{label}</span>
            <input
              className="native-switch-input"
              type="checkbox"
              checked={notificationSettings[key]}
              onChange={() => onNotificationToggle(key)}
            />
            <span className={`target-switch ${notificationSettings[key] ? 'on' : ''}`}><span /></span>
          </label>
        ))}
      </div>

      <div className="settings-block">
        <div className="settings-section-title">Menu bar items</div>
        <TrayToggles entries={trayEntries} onToggle={onTrayToggle} />
      </div>

      <div className="settings-block">
        <div className="settings-section-title">Recent events</div>
        {events.length > 0 ? (
          <div className="event-list">
            {events.slice(0, 6).map((event) => (
              <div className="event-row" key={event.id}>
                <span className={`event-dot ${event.level}`} />
                <span className="event-text">{event.text}</span>
                <span className="event-time">{formatEventTime(event.time)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="settings-hint">No events yet.</div>
        )}
      </div>

      {isMacOS && (
        <div className="settings-block">
          <div className="settings-section-title">Dock</div>
          <label className="settings-line">
            <span>Hide Dock icon</span>
            <input
              className="native-switch-input"
              type="checkbox"
              checked={dockHidden}
              onChange={onDockToggle}
            />
            <span className={`target-switch ${dockHidden ? 'on' : ''}`}><span /></span>
          </label>
        </div>
      )}
    </div>
  );
}

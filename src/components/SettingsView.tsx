import { useState } from 'react';
import ThemeSelector, { type ThemeName } from './ThemeSelector';
import type { TrayToggleEntry } from './TrayToggles';
import ProviderIcon from './ProviderIcon';
import type { TrayServiceName } from '../services/tray_visibility';
import {
  BUDGET_SOURCES,
  getSavedMonthlyBudgets,
  saveMonthlyBudgets,
  type MonthlyBudgets,
} from '../services/budget';
import { matchProviderInEventText, type ProviderPreset } from '../services/provider_presets';
import { SERVICE_META, SERVICES } from '../services/service_meta';
import type { SwitcherVisibility } from '../services/switcher_providers';
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
  switcherVisibility: SwitcherVisibility;
  onClose: () => void;
  onThemeChange: (theme: ThemeName) => void;
  onDockToggle: () => void;
  onTrayToggle: (service: TrayServiceName) => void;
  onPanelSectionToggle: (key: PanelSectionKey) => void;
  onTrayStyleChange: (style: TrayStyle) => void;
  onTrayCycleToggle: () => void;
  onNotificationToggle: (key: NotificationKey) => void;
  onSwitcherToggle: (service: TrayServiceName) => void;
  onApplyPreset: (preset: ProviderPreset) => void;
  onSelectEventProvider: (service: TrayServiceName) => void;
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
  switcherVisibility,
  onClose,
  onThemeChange,
  onDockToggle,
  onTrayToggle,
  onPanelSectionToggle,
  onTrayStyleChange,
  onTrayCycleToggle,
  onNotificationToggle,
  onSwitcherToggle,
  onApplyPreset,
  onSelectEventProvider,
}: SettingsViewProps) {
  const [budgets, setBudgets] = useState<MonthlyBudgets>(getSavedMonthlyBudgets);
  const enabledSwitcherCount = SERVICES.filter((service) => switcherVisibility[service]).length;
  const trayByService = new Map(trayEntries.map((entry) => [entry.service, entry]));

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

      <section className="settings-group" aria-labelledby="settings-appearance-title">
        <div className="settings-group-header">
          <span className="settings-group-index">01</span>
          <div>
            <h2 id="settings-appearance-title">Appearance</h2>
            <p>Theme and menu bar presentation</p>
          </div>
        </div>
        <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
        <div className="settings-subsection-title">Menu bar style</div>
        <div className="settings-seg">
          {TRAY_STYLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`settings-seg-btn ${trayStyle === option.id ? 'active' : ''}`}
              onClick={() => onTrayStyleChange(option.id)}
              aria-pressed={trayStyle === option.id}
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
      </section>

      <section className="settings-group" aria-labelledby="settings-providers-title">
        <div className="settings-group-header">
          <span className="settings-group-index">02</span>
          <div>
            <h2 id="settings-providers-title">Providers</h2>
            <p>Choose where each service appears</p>
          </div>
        </div>
        <div className="settings-subsection-title">Presets</div>
        <div className="settings-seg">
          <button
            type="button"
            className="settings-seg-btn"
            onClick={() => onApplyPreset('all')}
          >
            All
          </button>
          {SERVICES.map((service) => (
            <button
              key={service}
              type="button"
              className="settings-seg-btn"
              onClick={() => onApplyPreset(service)}
            >
              {SERVICE_META[service].shortLabel}
            </button>
          ))}
        </div>
        <div className="provider-visibility-grid">
          <div className="provider-visibility-head" aria-hidden="true">
            <span>Service</span>
            <span>Panel</span>
            <span>Menu</span>
          </div>
          {SERVICES.map((service) => {
            const meta = SERVICE_META[service];
            const trayEntry = trayByService.get(service);
            const panelEnabled = switcherVisibility[service];
            const panelLocked = panelEnabled && enabledSwitcherCount === 1;
            const trayLocked = !trayEntry || (trayEntry.enabled && !trayEntry.canDisable);
            const connectionHint = trayEntry?.connected
              ? trayEntry.connectedHint ?? 'Connected'
              : trayEntry?.disconnectedHint ?? 'Offline';
            return (
              <div className="provider-visibility-row" key={service}>
                <span className="provider-visibility-service">
                  <span className={`provider-mini-icon provider-${service}`} aria-hidden="true">
                    <ProviderIcon service={service} />
                  </span>
                  <span>
                    <strong>{meta.label}</strong>
                    <small className={trayEntry?.connected ? 'connected' : ''}>
                      {connectionHint}
                    </small>
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={panelEnabled}
                  aria-disabled={panelLocked}
                  aria-label={`Show ${meta.label} in panel`}
                  className={`target-switch compact ${panelEnabled ? 'on' : ''}`}
                  disabled={panelLocked}
                  onClick={() => onSwitcherToggle(service)}
                >
                  <span />
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={trayEntry?.enabled ?? false}
                  aria-disabled={trayLocked}
                  aria-label={`Show ${meta.label} in menu bar`}
                  className={`target-switch compact ${trayEntry?.enabled ? 'on' : ''}`}
                  disabled={trayLocked}
                  onClick={() => onTrayToggle(service)}
                >
                  <span />
                </button>
              </div>
            );
          })}
        </div>
        <div className="settings-hint">Hidden panel providers still refresh in the background.</div>
      </section>

      <section className="settings-group" aria-labelledby="settings-sections-title">
        <div className="settings-group-header">
          <span className="settings-group-index">03</span>
          <div>
            <h2 id="settings-sections-title">Panel content</h2>
            <p>Show only the sections you use</p>
          </div>
        </div>
        {PANEL_SECTION_ORDER.map((key) => (
          <div className="settings-line" key={key}>
            <span>{PANEL_SECTION_LABELS[key]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={panelSections[key]}
              aria-label={`Show ${PANEL_SECTION_LABELS[key]}`}
              className={`target-switch ${panelSections[key] ? 'on' : ''}`}
              onClick={() => onPanelSectionToggle(key)}
            >
              <span />
            </button>
          </div>
        ))}
      </section>

      <section className="settings-group" aria-labelledby="settings-limits-title">
        <div className="settings-group-header">
          <span className="settings-group-index">04</span>
          <div>
            <h2 id="settings-limits-title">Limits</h2>
            <p>Monthly API-equivalent budgets</p>
          </div>
        </div>
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
        <div className="settings-hint">Shown in the API-equivalent usage section.</div>
      </section>

      <section className="settings-group" aria-labelledby="settings-alerts-title">
        <div className="settings-group-header">
          <span className="settings-group-index">05</span>
          <div>
            <h2 id="settings-alerts-title">Alerts</h2>
            <p>Usage and bonus notifications</p>
          </div>
        </div>
        {NOTIFICATION_ROWS.map(({ key, label }) => (
          <div className="settings-line" key={key}>
            <span>{label}</span>
            <button
              type="button"
              role="switch"
              aria-checked={notificationSettings[key]}
              aria-label={label}
              className={`target-switch ${notificationSettings[key] ? 'on' : ''}`}
              onClick={() => onNotificationToggle(key)}
            >
              <span />
            </button>
          </div>
        ))}
      </section>

      <section className="settings-group" aria-labelledby="settings-system-title">
        <div className="settings-group-header">
          <span className="settings-group-index">06</span>
          <div>
            <h2 id="settings-system-title">Activity & system</h2>
            <p>Recent status changes and app behavior</p>
          </div>
        </div>
        <div className="settings-subsection-title">Recent events</div>
        {events.length > 0 ? (
          <div className="event-list">
            {events.slice(0, 6).map((event) => {
              const provider = matchProviderInEventText(event.text);
              return (
              <div className="event-row" key={event.id}>
                <span className={`event-dot ${event.level}`} />
                {provider ? (
                  <button
                    type="button"
                    className="event-text event-text-link"
                    onClick={() => onSelectEventProvider(provider)}
                  >
                    {event.text}
                  </button>
                ) : (
                  <span className="event-text">{event.text}</span>
                )}
                <span className="event-time">{formatEventTime(event.time)}</span>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="settings-hint">No events yet.</div>
        )}

        {isMacOS && (
          <>
            <div className="settings-subsection-title settings-subsection-divider">Dock</div>
            <div className="settings-line">
              <span>Hide Dock icon</span>
              <button
                type="button"
                role="switch"
                aria-checked={dockHidden}
                aria-label="Hide Dock icon"
                className={`target-switch ${dockHidden ? 'on' : ''}`}
                onClick={onDockToggle}
              >
                <span />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

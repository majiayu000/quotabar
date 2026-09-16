import { setLanguagePreference, type LanguagePreference, localizeLabel, renderText, t } from '../i18n';
import { useLanguagePreference, useLocale } from '../i18n/react';
import { useEffect, useState } from 'react';
import type { QuotaDisplay } from '../services/quota_display';
import ThemeSelector, { type ThemeName } from './ThemeSelector';
import type { TrayToggleEntry } from './TrayToggles';
import ProviderIcon from './ProviderIcon';
import type { TrayServiceName } from '../services/tray_visibility';
import { readAutostartEnabled, setAutostartEnabled } from '../services/autostart';
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
  PANEL_SECTION_ORDER,
  type PanelSectionKey,
  type PanelSectionVisibility,
} from '../services/panel_sections';

interface SettingsViewProps {
  initialPage?: 'display' | 'alerts' | 'accounts';
  workspace?: boolean;
  quotaDisplay?: QuotaDisplay;
  onQuotaDisplayChange?: (display: QuotaDisplay) => void;
  isMacOS: boolean;
  showDockToggle?: boolean;
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
  onAutostartNotice?: (message: string) => void;
}

export default function SettingsView({
  initialPage = 'display',
  workspace = false,
  quotaDisplay,
  onQuotaDisplayChange,
  isMacOS,
  showDockToggle = true,
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
  onAutostartNotice,
}: SettingsViewProps) {
  useLocale();
  const language = useLanguagePreference();
  const [tab, setTab] = useState(initialPage);
    const [budgets, setBudgets] = useState<MonthlyBudgets>(getSavedMonthlyBudgets);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const enabledSwitcherCount = SERVICES.filter((service) => switcherVisibility[service]).length;
  const trayByService = new Map(trayEntries.map((entry) => [entry.service, entry]));

  useEffect(() => {
    let cancelled = false;
    void readAutostartEnabled().then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') {
        setLaunchAtLogin(result.enabled);
        setAutostartError(null);
        return;
      }
      setLaunchAtLogin(false);
      setAutostartError(result.status === 'failure' ? result.message : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLaunchAtLoginToggle = async () => {
    if (autostartBusy) return;
    const requested = !launchAtLogin;
    setAutostartBusy(true);
    const result = await setAutostartEnabled(requested);
    setAutostartBusy(false);
    if (result.status === 'ok') {
      setLaunchAtLogin(result.enabled);
      setAutostartError(null);
      return;
    }
    setAutostartError(result.message);
    onAutostartNotice?.(result.message);
  };

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
    <div className={`settings-view compact-settings ${workspace ? 'workspace-settings' : ''}`} aria-label={t("Settings")}>
      <div className="settings-view-header" hidden={workspace}>
        <button
          type="button"
          className="settings-back-btn"
          onClick={onClose}
          aria-label={t("Back to provider view")}
        >
          ‹
        </button>
        <div>
          <div className="overview-kicker">QuotaBar</div>
          <h1>{t("Settings")}</h1>
        </div>
      </div>

      <nav className="settings-tabs" aria-label={t("Settings categories")}>
        {([['display', t("Display")], ['alerts', t("Alerts")], ['accounts', t("Accounts")]] as const).map(([id, label]) => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined}
            aria-controls="settings-content" onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <div id="settings-content">
      <section className="settings-group" hidden={tab !== 'display'} aria-labelledby="settings-appearance-title">
        <div className="settings-group-header">
          <span className="settings-group-index">01</span>
          <div>
            <h2 id="settings-appearance-title">{t("Appearance")}</h2>
            <p>{t("Theme and menu bar presentation")}</p>
          </div>
        </div>
        <label className="settings-line">
          <span>{t("Language")}</span>
          <select aria-label={t("Language")} value={language}
            onChange={(event) => setLanguagePreference(event.target.value as LanguagePreference)}>
            <option value="system">{t("Follow system")}</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        {quotaDisplay && onQuotaDisplayChange && <>
          <div className="settings-subsection-title">{t("Quota overview")}</div>
          <p className="settings-hint">{t("All quota percentages and rings show remaining capacity.")}</p>
          <div className="settings-line"><span>{t("Show weekly quota details")}</span>
            <button type="button" role="switch" aria-label={t("Show weekly quota details")} aria-checked={quotaDisplay.weekly}
              className={`target-switch ${quotaDisplay.weekly ? 'on' : ''}`}
              onClick={() => onQuotaDisplayChange({ ...quotaDisplay, weekly: !quotaDisplay.weekly })}><span /></button>
          </div>
          <p className="settings-hint">{t("The overview always highlights the quota closest to its limit.")}</p>
        </>}
        <details className="settings-disclosure">
          <summary>{t("Change colors")}</summary>
          <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
        </details>
        <div className="settings-subsection-title">{t("Menu bar style")}</div>
        <div className="settings-seg">
          {TRAY_STYLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`settings-seg-btn ${trayStyle === option.id ? 'active' : ''}`}
              onClick={() => onTrayStyleChange(option.id)}
              aria-pressed={trayStyle === option.id}
            >
              {({ percent: t("Percent"), ring: t("Ring"), icon: t("Icon only") })[option.id]}
            </button>
          ))}
        </div>
        <p className="settings-hint">{t("Menu bar percentages and rings show remaining quota.")}</p>
        <div className="settings-line">
          <span>{t("Cycle one icon through providers")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={trayCycle}
            aria-label={t("Cycle one icon through providers")}
            className={`target-switch ${trayCycle ? 'on' : ''}`}
            onClick={onTrayCycleToggle}
          >
            <span />
          </button>
        </div>
      </section>

      <section className="settings-group" hidden={tab !== 'accounts'} aria-labelledby="settings-providers-title">
        <div className="settings-group-header">
          <span className="settings-group-index">02</span>
          <div>
            <h2 id="settings-providers-title">{t("Providers")}</h2>
            <p>{t("Choose where each service appears")}</p>
          </div>
        </div>
        <div className="settings-subsection-title">{t("Presets")}</div>
        <div className="settings-seg settings-presets">
          <button
            type="button"
            className="settings-seg-btn"
            onClick={() => onApplyPreset('all')}
          >
            {t("All")}
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
            <span>{t("Service")}</span>
            <span>{t("Panel")}</span>
            <span>{t("Menu")}</span>
          </div>
          {SERVICES.map((service) => {
            const meta = SERVICE_META[service];
            const trayEntry = trayByService.get(service);
            const panelEnabled = switcherVisibility[service];
            const panelLocked = panelEnabled && enabledSwitcherCount === 1;
            const trayLocked = !trayEntry || (trayEntry.enabled && !trayEntry.canDisable);
            const connectionHint = trayEntry?.connected ? t("Connected") : service === 'antigravity' ? t("Preview") : t("Sign-in required");
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
                  aria-label={t("Show {p0} in panel", { p0: meta.label })}
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
                  aria-label={t("Show {p0} in menu bar", { p0: meta.label })}
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
        <div className="settings-subsection-title">{t("Recent events")}</div>
        {events.length > 0 ? (
          <div className="event-list">
            {events.slice(0, 6).map((event) => {
              const provider = matchProviderInEventText(renderText(event.text, 'en'));
              return (
              <div className="event-row" key={event.id}>
                <span className={`event-dot ${event.level}`} />
                {provider ? (
                  <button
                    type="button"
                    className="event-text event-text-link"
                    onClick={() => onSelectEventProvider(provider)}
                  >
                    {renderText(event.text)}
                  </button>
                ) : (
                  <span className="event-text">{renderText(event.text)}</span>
                )}
                <span className="event-time">{formatEventTime(event.time)}</span>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="settings-hint">{t("No events yet.")}</div>
        )}

        <div className="settings-hint">{t("Hidden panel providers still refresh in the background.")}</div>
      </section>

      <section className="settings-group" hidden={tab !== 'display'} aria-labelledby="settings-sections-title">
        <div className="settings-group-header">
          <span className="settings-group-index">03</span>
          <div>
            <h2 id="settings-sections-title">{t("Panel content")}</h2>
            <p>{t("Show only the sections you use")}</p>
          </div>
        </div>
        {PANEL_SECTION_ORDER.map((key) => (
          <div className="settings-line" key={key}>
            <span>{({ timeline: t("Reset timeline"), cost: t("API-equivalent usage"), trend: t("Usage trend"), tips: t("Usage tips") })[key]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={panelSections[key]}
              aria-label={t("Show {p0}", { p0: ({ timeline: t("Reset timeline"), cost: t("API-equivalent usage"), trend: t("Usage trend"), tips: t("Usage tips") })[key] })}
              className={`target-switch ${panelSections[key] ? 'on' : ''}`}
              onClick={() => onPanelSectionToggle(key)}
            >
              <span />
            </button>
          </div>
        ))}
      </section>

      <section className="settings-group" hidden={tab !== 'alerts'} aria-labelledby="settings-alerts-title">
        <div className="settings-group-header">
          <span className="settings-group-index">05</span>
          <div>
            <h2 id="settings-alerts-title">{t("Alerts")}</h2>
            <p>{t("Usage and bonus notifications")}</p>
          </div>
        </div>
        {NOTIFICATION_ROWS.map(({ key, label }) => (
          <div className="settings-line" key={key}>
            <span>{({ q80: t("Alert at 20% remaining"), q95: t("Critical alert at 5% remaining"), q100: t("Alert at 0% remaining"), bonusReady: t("Alert when a bonus reset is unused at 0% remaining"), bonus: t("Bonus expiry reminders") })[key]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={notificationSettings[key]}
              aria-label={localizeLabel(label)}
              className={`target-switch ${notificationSettings[key] ? 'on' : ''}`}
              onClick={() => onNotificationToggle(key)}
            >
              <span />
            </button>
          </div>
        ))}
      </section>

      <details className="settings-disclosure" hidden={tab !== 'alerts'}>
        <summary>{t("Usage reference budgets")}</summary>
      <section className="settings-group" hidden={tab !== 'alerts'} aria-labelledby="settings-limits-title">
        <div className="settings-group-header">
          <span className="settings-group-index">04</span>
          <div>
            <h2 id="settings-limits-title">{t("Limits")}</h2>
            <p>{t("Monthly API-equivalent budgets")}</p>
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
                placeholder={t("none")}
                value={budgets[source] ?? ''}
                onChange={(event) => handleBudgetChange(source, event.target.value)}
                aria-label={t("{p0} monthly budget in USD", { p0: SERVICE_META[source].label })}
              />
            </span>
          </label>
        ))}
        <div className="settings-hint">{t("Shown in the API-equivalent usage section.")}</div>
      </section>

      </details>

      <section className="settings-group" hidden={tab !== 'display'} aria-labelledby="settings-system-title">
        <div className="settings-group-header">
          <span className="settings-group-index">06</span>
          <div>
            <h2 id="settings-system-title">{t("Activity & system")}</h2>
            <p>{t("Recent status changes and app behavior")}</p>
          </div>
        </div>
        <div className="settings-subsection-title settings-subsection-divider">{t("Startup")}</div>
        <div className="settings-line">
          <span>{t("Launch at Login")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={launchAtLogin}
            aria-label={t("Launch at Login")}
            disabled={autostartBusy}
            className={`target-switch ${launchAtLogin ? 'on' : ''}`}
            onClick={() => {
              void handleLaunchAtLoginToggle();
            }}
          >
            <span />
          </button>
        </div>
        {autostartError ? (
          <div className="settings-hint" role="alert">{localizeLabel(autostartError)}</div>
        ) : null}

        {isMacOS && showDockToggle && (
          <>
            <div className="settings-subsection-title settings-subsection-divider">Dock</div>
            <div className="settings-line">
              <span>{t("Hide Dock icon")}</span>
              <button
                type="button"
                role="switch"
                aria-checked={dockHidden}
                aria-label={t("Hide Dock icon")}
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
    </div>
  );
}

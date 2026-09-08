import { useEffect, useState } from 'react';
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
  PANEL_SECTION_LABELS,
  PANEL_SECTION_ORDER,
  type PanelSectionKey,
  type PanelSectionVisibility,
} from '../services/panel_sections';

interface SettingsViewProps {
  workspace?: boolean;
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
  workspace = false,
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
  const text = (en: string, zh: string) => workspace ? zh : en;
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
    <div className={`settings-view ${workspace ? 'workspace-settings' : ''}`} aria-label={text('Settings', '工作区设置')}>
      <div className="settings-view-header" hidden={workspace}>
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
            <h2 id="settings-appearance-title">{text('Appearance', '外观与菜单栏')}</h2>
            <p>{text('Theme and menu bar presentation', 'App 使用统一浅深色外观，菜单栏可选择独立的配色风格。')}</p>
          </div>
        </div>
        <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
        <div className="settings-subsection-title">{text('Menu bar style', '菜单栏图标样式')}</div>
        <div className="settings-seg">
          {TRAY_STYLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`settings-seg-btn ${trayStyle === option.id ? 'active' : ''}`}
              onClick={() => onTrayStyleChange(option.id)}
              aria-pressed={trayStyle === option.id}
            >
              {workspace ? ({ percent: '百分比', ring: '圆环', icon: '仅图标' })[option.id] : option.label}
            </button>
          ))}
        </div>
        <div className="settings-line">
          <span>{text('Cycle one icon through providers', '用一个图标轮换显示来源')}</span>
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
            <h2 id="settings-providers-title">{text('Providers', '来源显示')}</h2>
            <p>{text('Choose where each service appears', '选择各来源在快捷面板和系统菜单栏中的显示位置。')}</p>
          </div>
        </div>
        <div className="settings-subsection-title">{text('Presets', '快速选择')}</div>
        <div className="settings-seg">
          <button
            type="button"
            className="settings-seg-btn"
            onClick={() => onApplyPreset('all')}
          >
            {text('All', '全部')}
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
            <span>{text('Service', '来源')}</span>
            <span>{text('Panel', '面板')}</span>
            <span>{text('Menu', '菜单栏')}</span>
          </div>
          {SERVICES.map((service) => {
            const meta = SERVICE_META[service];
            const trayEntry = trayByService.get(service);
            const panelEnabled = switcherVisibility[service];
            const panelLocked = panelEnabled && enabledSwitcherCount === 1;
            const trayLocked = !trayEntry || (trayEntry.enabled && !trayEntry.canDisable);
            const connectionHint = workspace ? (trayEntry?.connected ? '已连接' : '未连接') : trayEntry?.connected
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
        <div className="settings-hint">{text('Hidden panel providers still refresh in the background.', '隐藏面板入口后，账户数据仍会在后台刷新。')}</div>
      </section>

      <section className="settings-group" aria-labelledby="settings-sections-title">
        <div className="settings-group-header">
          <span className="settings-group-index">03</span>
          <div>
            <h2 id="settings-sections-title">{text('Panel content', '快捷面板内容')}</h2>
            <p>{text('Show only the sections you use', '调整原有菜单栏面板中的信息区块。')}</p>
          </div>
        </div>
        {PANEL_SECTION_ORDER.map((key) => (
          <div className="settings-line" key={key}>
            <span>{workspace ? ({ timeline: '重置时间线', cost: 'API 等价用量', trend: '用量趋势', tips: '使用提示' })[key] : PANEL_SECTION_LABELS[key]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={panelSections[key]}
              aria-label={`Show ${workspace ? ({ timeline: '重置时间线', cost: 'API 等价用量', trend: '用量趋势', tips: '使用提示' })[key] : PANEL_SECTION_LABELS[key]}`}
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
            <h2 id="settings-limits-title">{text('Limits', '用量参考预算')}</h2>
            <p>{text('Monthly API-equivalent budgets', '每月 API 等价估算上限，单位为 USD；不会限制实际消费。')}</p>
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
                placeholder={text("none", "未设置")}
                value={budgets[source] ?? ''}
                onChange={(event) => handleBudgetChange(source, event.target.value)}
                aria-label={`${SERVICE_META[source].label} monthly budget in USD`}
              />
            </span>
          </label>
        ))}
        <div className="settings-hint">{text('Shown in the API-equivalent usage section.', '在快捷面板的 API 等价用量区域显示，不代表服务商账单。')}</div>
      </section>

      <section className="settings-group" aria-labelledby="settings-alerts-title">
        <div className="settings-group-header">
          <span className="settings-group-index">05</span>
          <div>
            <h2 id="settings-alerts-title">{text('Alerts', '提醒')}</h2>
            <p>{text('Usage and bonus notifications', '在额度接近用尽或奖励到期时提醒。')}</p>
          </div>
        </div>
        {NOTIFICATION_ROWS.map(({ key, label }) => (
          <div className="settings-line" key={key}>
            <span>{workspace ? ({ q80: '使用达到 80% 时提醒', q95: '使用达到 95% 时紧急提醒', q100: '使用达到 100% 时提醒', bonusReady: '额度用尽但有未使用奖励重置时提醒', bonus: '奖励到期提醒' })[key] : label}</span>
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
            <h2 id="settings-system-title">{text('Activity & system', '活动与系统')}</h2>
            <p>{text('Recent status changes and app behavior', '最近的连接变化和应用启动设置。')}</p>
          </div>
        </div>
        <div className="settings-subsection-title">{text('Recent events', '最近事件')}</div>
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
          <div className="settings-hint">{text('No events yet.', '还没有状态变化记录。')}</div>
        )}

        <div className="settings-subsection-title settings-subsection-divider">{text('Startup', '启动')}</div>
        <div className="settings-line">
          <span>{text('Launch at Login', '登录时启动')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={launchAtLogin}
            aria-label="Launch at Login"
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
          <div className="settings-hint" role="alert">{autostartError}</div>
        ) : null}

        {isMacOS && showDockToggle && (
          <>
            <div className="settings-subsection-title settings-subsection-divider">Dock</div>
            <div className="settings-line">
              <span>{text('Hide Dock icon', '隐藏 Dock 图标')}</span>
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

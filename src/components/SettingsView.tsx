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
  const [tab, setTab] = useState(initialPage);
  const text = (_en: string, zh: string) => zh;
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
    <div className={`settings-view compact-settings ${workspace ? 'workspace-settings' : ''}`} aria-label={text('Settings', '工作区设置')}>
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
          <div className="overview-kicker">QuotaBar</div>
          <h1>设置</h1>
        </div>
      </div>

      <nav className="settings-tabs" aria-label="设置分类">
        {([['display', '显示'], ['alerts', '提醒'], ['accounts', '账户']] as const).map(([id, label]) => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined}
            aria-controls="settings-content" onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <div id="settings-content">
      <section className="settings-group" hidden={tab !== 'display'} aria-labelledby="settings-appearance-title">
        <div className="settings-group-header">
          <span className="settings-group-index">01</span>
          <div>
            <h2 id="settings-appearance-title">{text('Appearance', '额度与外观')}</h2>
            <p>{text('Theme and menu bar presentation', '选择你习惯的读数和配色。')}</p>
          </div>
        </div>
        {quotaDisplay && onQuotaDisplayChange && <>
          <div className="settings-subsection-title">额度总览</div>
          <div className="settings-line">
            <span>显示数值</span>
            <div className="settings-seg quota-value-options" aria-label="总览额度显示方式">
              {([['remaining', '剩余'], ['used', '已用']] as const).map(([value, label]) => (
                <button type="button" key={value} className={`settings-seg-btn ${quotaDisplay.value === value ? 'active' : ''}`}
                  aria-pressed={quotaDisplay.value === value} onClick={() => onQuotaDisplayChange({ ...quotaDisplay, value })}>{label}</button>
              ))}
            </div>
          </div>
          <div className="settings-line"><span>显示每周额度明细</span>
            <button type="button" role="switch" aria-label="显示每周额度明细" aria-checked={quotaDisplay.weekly}
              className={`target-switch ${quotaDisplay.weekly ? 'on' : ''}`}
              onClick={() => onQuotaDisplayChange({ ...quotaDisplay, weekly: !quotaDisplay.weekly })}><span /></button>
          </div>
          <p className="settings-hint">总览始终突出最接近用尽的额度。</p>
        </>}
        <details className="settings-disclosure">
          <summary>更改配色</summary>
          <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
        </details>
        <div className="settings-subsection-title">{text('Menu bar style', '菜单栏')}</div>
        <div className="settings-seg">
          {TRAY_STYLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`settings-seg-btn ${trayStyle === option.id ? 'active' : ''}`}
              onClick={() => onTrayStyleChange(option.id)}
              aria-pressed={trayStyle === option.id}
            >
              {({ percent: '百分比', ring: '圆环', icon: '仅图标' })[option.id]}
            </button>
          ))}
        </div>
        <p className="settings-hint">菜单栏百分比与圆环表示已用额度。</p>
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

      <section className="settings-group" hidden={tab !== 'accounts'} aria-labelledby="settings-providers-title">
        <div className="settings-group-header">
          <span className="settings-group-index">02</span>
          <div>
            <h2 id="settings-providers-title">{text('Providers', '来源显示')}</h2>
            <p>{text('Choose where each service appears', '选择各来源在快捷面板和系统菜单栏中的显示位置。')}</p>
          </div>
        </div>
        <div className="settings-subsection-title">{text('Presets', '快速选择')}</div>
        <div className="settings-seg settings-presets">
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
            const connectionHint = trayEntry?.connected ? '已连接' : service === 'antigravity' ? '预览' : '需登录';
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

        <div className="settings-hint">{text('Hidden panel providers still refresh in the background.', '隐藏面板入口后，账户数据仍会在后台刷新。')}</div>
      </section>

      <section className="settings-group" hidden={tab !== 'display'} aria-labelledby="settings-sections-title">
        <div className="settings-group-header">
          <span className="settings-group-index">03</span>
          <div>
            <h2 id="settings-sections-title">{text('Panel content', '服务详情内容')}</h2>
            <p>{text('Show only the sections you use', '进入单个服务详情后显示的信息。')}</p>
          </div>
        </div>
        {PANEL_SECTION_ORDER.map((key) => (
          <div className="settings-line" key={key}>
            <span>{({ timeline: '重置时间线', cost: 'API 等价用量', trend: '用量趋势', tips: '使用提示' })[key]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={panelSections[key]}
              aria-label={`Show ${({ timeline: '重置时间线', cost: 'API 等价用量', trend: '用量趋势', tips: '使用提示' })[key]}`}
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
            <h2 id="settings-alerts-title">{text('Alerts', '提醒')}</h2>
            <p>{text('Usage and bonus notifications', '在额度接近用尽或奖励到期时提醒。')}</p>
          </div>
        </div>
        {NOTIFICATION_ROWS.map(({ key, label }) => (
          <div className="settings-line" key={key}>
            <span>{({ q80: '剩余额度降至 20% 时提醒', q95: '剩余额度降至 5% 时提醒', q100: '额度用尽时提醒', bonusReady: '额度用尽但有未使用奖励重置时提醒', bonus: '奖励到期提醒' })[key]}</span>
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

      <details className="settings-disclosure" hidden={tab !== 'alerts'}>
        <summary>用量参考预算</summary>
      <section className="settings-group" hidden={tab !== 'alerts'} aria-labelledby="settings-limits-title">
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

      </details>

      <section className="settings-group" hidden={tab !== 'display'} aria-labelledby="settings-system-title">
        <div className="settings-group-header">
          <span className="settings-group-index">06</span>
          <div>
            <h2 id="settings-system-title">{text('Activity & system', '系统')}</h2>
            <p>{text('Recent status changes and app behavior', '应用启动和 Dock 显示。')}</p>
          </div>
        </div>
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
    </div>
  );
}

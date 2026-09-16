import { useLocale } from '../i18n/react';
import { t } from '../i18n';
interface ActionButtonsProps {
  compact?: boolean;
  onRefresh: () => void;
  onAnalysis?: () => void;
  onDashboard: () => void;
  onSettings: () => void;
  onQuit: () => void;
  loading: boolean;
  settingsActive?: boolean;
  statusText?: string;
  statusTitle?: string;
  showDashboard?: boolean;
}

export default function ActionButtons({
  compact = false,
  onRefresh,
  onAnalysis,
  onDashboard,
  onSettings,
  onQuit,
  loading,
  settingsActive = false,
  statusText,
  statusTitle,
  showDashboard = true,
}: ActionButtonsProps) {
  useLocale();
  return (
    <>
      <div className="footer-divider" />
      <div className={`action-buttons${compact ? ' compact-actions' : ''}`} aria-busy={loading}>
        {loading && (
          <span className="action-announcement" role="status" aria-live="polite">
            {t("Updating quota data")}</span>
        )}
        <button
          type="button"
          className="action-btn refresh-btn"
          onClick={onRefresh}
          disabled={loading}
          title={statusTitle ? t("Refresh · {p0}", { p0: statusTitle }) : t("Refresh")}
          aria-label={t("Refresh current provider")}
        >
          <span className="btn-icon">{loading ? '...' : '↻'}</span>
          <span className="btn-text">{loading ? t("Refreshing") : compact && statusText ? statusText.replace(t("Last successful read "), '').replace('now', t("Just updated")) : t("Refresh")}</span>
        </button>

        {(onAnalysis || showDashboard) && (
          <button
            type="button"
            className="action-btn dashboard-btn"
            onClick={onAnalysis ?? onDashboard}
            title={onAnalysis ? t("Open usage analysis") : t("Open dashboard")}
            aria-label={onAnalysis ? t("Open usage analysis") : t("Open provider dashboard")}
          >
            <span className="btn-text">{onAnalysis ? t("Usage analysis") : t("Provider dashboard")}</span>
            <span className="btn-icon dashboard-arrow">↗</span>
          </button>
        )}

        {statusText && !compact && (
          <span
            className="action-status"
            aria-live="off"
            title={statusTitle ?? statusText}
          >
            {statusText}
          </span>
        )}

        {!compact && <button
          type="button"
          className={`action-btn icon-action settings-btn ${settingsActive ? 'active' : ''}`}
          onClick={onSettings}
          title={t("Settings")}
          aria-label={t("Open settings")}
          aria-pressed={settingsActive}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>}

        <button
          type="button"
          className="action-btn icon-action quit-btn"
          onClick={onQuit}
          title={t("Quit")}
          aria-label={t("Quit QuotaBar")}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M18.36 6.64a9 9 0 1 1-12.72 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </button>
      </div>
    </>
  );
}

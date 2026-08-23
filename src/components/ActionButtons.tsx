interface ActionButtonsProps {
  onRefresh: () => void;
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
  onRefresh,
  onDashboard,
  onSettings,
  onQuit,
  loading,
  settingsActive = false,
  statusText,
  statusTitle,
  showDashboard = true,
}: ActionButtonsProps) {
  return (
    <>
      <div className="footer-divider" />
      <div className="action-buttons" aria-busy={loading}>
        <button
          type="button"
          className="action-btn refresh-btn"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh current provider"
        >
          <span className="btn-icon">{loading ? '...' : '↻'}</span>
          <span className="btn-text">{loading ? 'Loading' : 'Refresh'}</span>
        </button>

        {showDashboard && (
          <button
            type="button"
            className="action-btn dashboard-btn"
            onClick={onDashboard}
            title="Open dashboard"
            aria-label="Open provider dashboard"
          >
            <span className="btn-text">Dashboard</span>
            <span className="btn-icon dashboard-arrow">↗</span>
          </button>
        )}

        {statusText && (
          <span
            className="action-status"
            role="status"
            aria-live="polite"
            title={statusTitle ?? statusText}
          >
            {statusText}
          </span>
        )}

        <button
          type="button"
          className={`action-btn icon-action settings-btn ${settingsActive ? 'active' : ''}`}
          onClick={onSettings}
          title="Settings"
          aria-label="Open settings"
          aria-pressed={settingsActive}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <button
          type="button"
          className="action-btn icon-action quit-btn"
          onClick={onQuit}
          title="Quit"
          aria-label="Quit QuotaBar"
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

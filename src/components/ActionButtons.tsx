import type { CSSProperties } from 'react';

interface ActionButtonsProps {
  onRefresh: () => void;
  onDashboard: () => void;
  onSettings: () => void;
  onQuit: () => void;
  loading: boolean;
  settingsActive?: boolean;
  statusText?: string;
}

const footerDividerStyle: CSSProperties = {
  height: '1px',
  background: 'var(--line,rgba(0,0,0,0.08))',
  margin: '6px 4px 0',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '7px 6px 4px',
  flexWrap: 'nowrap',
  overflow: 'hidden',
};

const baseButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
  border: 0,
  appearance: 'none',
  boxShadow: 'none',
  cursor: 'pointer',
  color: 'var(--text)',
  background: 'transparent',
  fontFamily: 'inherit',
};

const refreshButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  gap: '5px',
  padding: '5px 11px',
  borderRadius: '7px',
  fontSize: '12px',
  fontWeight: 600,
  background: 'rgba(10,132,255,0.12)',
  color: 'var(--acc,#0A6DDB)',
};

const refreshIconStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: '13px',
};

const dashboardButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  gap: '5px',
  padding: '5px 9px',
  borderRadius: '7px',
  fontSize: '12px',
  fontWeight: 500,
};

const statusStyle: CSSProperties = {
  flex: '1 1 76px',
  minWidth: '76px',
  textAlign: 'right',
  fontSize: '11px',
  lineHeight: '14px',
  color: 'var(--sub,rgba(60,60,67,0.6))',
  paddingRight: '4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const iconButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  width: '28px',
  height: '28px',
  flexBasis: '28px',
  padding: 0,
  borderRadius: '7px',
  fontSize: '18px',
  color: 'var(--sub,rgba(60,60,67,0.7))',
};

export default function ActionButtons({
  onRefresh,
  onDashboard,
  onSettings,
  onQuit,
  loading,
  settingsActive = false,
  statusText,
}: ActionButtonsProps) {
  return (
    <>
      <div className="footer-divider" style={footerDividerStyle} />
      <div className="action-buttons" style={footerStyle}>
        <button
          className="action-btn refresh-btn"
          style={refreshButtonStyle}
          onClick={onRefresh}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh current provider"
        >
          <span className="btn-icon" style={refreshIconStyle}>{loading ? '...' : '↻'}</span>
          <span className="btn-text">{loading ? 'Loading' : 'Refresh'}</span>
        </button>

        <button
          className="action-btn dashboard-btn"
          style={dashboardButtonStyle}
          onClick={onDashboard}
          title="Open dashboard"
          aria-label="Open provider dashboard"
        >
          <span className="btn-text">Dashboard</span>
          <span className="btn-icon dashboard-arrow">↗</span>
        </button>

        {statusText && (
          <span className="action-status" style={statusStyle} title={statusText}>
            {statusText}
          </span>
        )}

        <button
          className={`action-btn icon-action settings-btn ${settingsActive ? 'active' : ''}`}
          style={iconButtonStyle}
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
          className="action-btn icon-action quit-btn"
          style={iconButtonStyle}
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

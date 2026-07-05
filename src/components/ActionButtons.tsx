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
          <span className="btn-icon">⚙</span>
        </button>

        <button
          className="action-btn icon-action quit-btn"
          style={{ ...iconButtonStyle, fontSize: '16px' }}
          onClick={onQuit}
          title="Quit"
          aria-label="Quit QuotaBar"
        >
          <span className="btn-icon">⏻</span>
        </button>
      </div>
    </>
  );
}

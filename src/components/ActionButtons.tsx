interface ActionButtonsProps {
  onRefresh: () => void;
  onDashboard: () => void;
  onQuit: () => void;
  loading: boolean;
}

export default function ActionButtons({
  onRefresh,
  onDashboard,
  onQuit,
  loading,
}: ActionButtonsProps) {
  return (
    <div className="action-buttons">
      <button
        className="action-btn refresh-btn"
        onClick={onRefresh}
        disabled={loading}
      >
        <span className="btn-icon">{loading ? '...' : '↻'}</span>
        <span className="btn-text">{loading ? 'Loading' : 'Refresh'}</span>
      </button>

      <button className="action-btn dashboard-btn" onClick={onDashboard}>
        <span className="btn-icon">⊞</span>
        <span className="btn-text">Dashboard</span>
      </button>

      <button className="action-btn quit-btn" onClick={onQuit}>
        <span className="btn-icon">⏻</span>
        <span className="btn-text">Quit</span>
      </button>
    </div>
  );
}

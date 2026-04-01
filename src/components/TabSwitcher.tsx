export type TabName = 'claude' | 'codex';

interface TabSwitcherProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  claudeConnected: boolean;
  codexConnected: boolean;
}

export default function TabSwitcher({
  activeTab,
  onTabChange,
  claudeConnected,
  codexConnected,
}: TabSwitcherProps) {
  return (
    <div className="tab-switcher">
      <button
        className={`tab-button ${activeTab === 'claude' ? 'active' : ''}`}
        onClick={() => onTabChange('claude')}
      >
        <span className={`status-dot ${claudeConnected ? 'connected' : 'disconnected'}`} />
        Claude
      </button>
      <button
        className={`tab-button ${activeTab === 'codex' ? 'active' : ''}`}
        onClick={() => onTabChange('codex')}
      >
        <span className={`status-dot ${codexConnected ? 'connected' : 'disconnected'}`} />
        Codex
      </button>
    </div>
  );
}

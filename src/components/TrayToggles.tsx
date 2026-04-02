import type { TrayServiceName } from '../services/tray_visibility';

interface TrayTogglesProps {
  claudeEnabled: boolean;
  codexEnabled: boolean;
  claudeConnected: boolean;
  codexConnected: boolean;
  onToggle: (service: TrayServiceName) => void;
}

function renderToggle(
  service: TrayServiceName,
  label: string,
  enabled: boolean,
  connected: boolean,
  onToggle: (service: TrayServiceName) => void,
) {
  return (
    <label className="dock-toggle tray-toggle" key={service}>
      <span className="tray-toggle-copy">
        <span className="toggle-label">{label}</span>
        <span className={`tray-toggle-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Placeholder until login'}
        </span>
      </span>
      <input
        type="checkbox"
        checked={enabled}
        onChange={() => onToggle(service)}
      />
    </label>
  );
}

export default function TrayToggles({
  claudeEnabled,
  codexEnabled,
  claudeConnected,
  codexConnected,
  onToggle,
}: TrayTogglesProps) {
  return (
    <div className="tray-settings">
      <div className="settings-title">Tray</div>
      <div className="tray-toggle-list">
        {renderToggle('claude', 'Claude Tray', claudeEnabled, claudeConnected, onToggle)}
        {renderToggle('codex', 'Codex Tray', codexEnabled, codexConnected, onToggle)}
      </div>
    </div>
  );
}

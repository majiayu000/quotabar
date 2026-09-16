import { localizeLabel, t } from '../i18n';
import { useLocale } from '../i18n/react';
import type { TrayServiceName } from '../services/tray_visibility';
import { SERVICE_META, SERVICES } from '../services/service_meta';

export function buildTrayEntries(enabled: Record<TrayServiceName, boolean>, connected: Record<TrayServiceName, boolean>): TrayToggleEntry[] {
  return SERVICES.map((service) => ({
    service,
    label: SERVICE_META[service].trayLabel,
    enabled: enabled[service],
    canDisable: SERVICES.some((other) => other !== service && enabled[other]),
    connected: connected[service],
    connectedHint: SERVICE_META[service].connectedHint,
    disconnectedHint: SERVICE_META[service].disconnectedHint,
  }));
}

export interface TrayToggleEntry {
  service: TrayServiceName;
  label: string;
  enabled: boolean;
  canDisable: boolean;
  connected: boolean;
  connectedHint?: string;
  disconnectedHint: string;
}

interface TrayTogglesProps {
  entries: TrayToggleEntry[];
  onToggle: (service: TrayServiceName) => void;
}

function renderToggle(entry: TrayToggleEntry, onToggle: (service: TrayServiceName) => void) {
  const disableToggle = entry.enabled && !entry.canDisable;
  const statusText = entry.connected
    ? entry.connectedHint ?? t("Connected")
    : entry.disconnectedHint;
  return (
    <div className="dock-toggle tray-toggle" key={entry.service}>
      <span className="tray-toggle-copy">
        <span className="toggle-label">{localizeLabel(entry.label)}</span>
        <span className={`tray-toggle-status ${entry.connected ? 'connected' : 'disconnected'}`}>
          {localizeLabel(statusText)}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        className={`tray-toggle-button ${entry.enabled ? 'checked' : ''} ${disableToggle ? 'disabled' : ''}`}
        aria-checked={entry.enabled}
        aria-disabled={disableToggle}
        aria-label={t("{p0} toggle", { p0: localizeLabel(entry.label) })}
        disabled={disableToggle}
        onClick={() => onToggle(entry.service)}
      >
        <span className="tray-toggle-thumb" />
      </button>
    </div>
  );
}

export default function TrayToggles({ entries, onToggle }: TrayTogglesProps) {
  useLocale();
  return (
    <div className="tray-settings">
      <div className="settings-title">{t("Tray")}</div>
      <div className="tray-toggle-list">
        {entries.map((entry) => renderToggle(entry, onToggle))}
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import { SERVICE_META } from '../services/service_meta';
import type { TrayServiceName } from '../services/tray_visibility';

interface ProviderDetailHeaderProps {
  service: TrayServiceName;
  status: string;
  plan?: string;
  usedPercent?: number | null;
}

export default function ProviderDetailHeader({
  service,
  status,
  plan,
  usedPercent,
}: ProviderDetailHeaderProps) {
  const meta = SERVICE_META[service];
  const style = { '--service-accent': meta.accent } as CSSProperties;
  const usageLabel = usedPercent == null ? '--' : `${Math.round(usedPercent)}%`;

  return (
    <div className="provider-detail-header" style={style}>
      <span className="provider-detail-icon" aria-hidden="true">{meta.initials}</span>
      <span className="provider-detail-copy">
        <span className="provider-detail-name">{meta.label}</span>
        <span className="provider-detail-status">{plan ? `${plan} / ${status}` : status}</span>
      </span>
      <span className="provider-detail-usage">{usageLabel}</span>
    </div>
  );
}

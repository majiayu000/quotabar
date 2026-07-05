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
  usedPercent: _usedPercent,
}: ProviderDetailHeaderProps) {
  const meta = SERVICE_META[service];

  return (
    <div className="provider-detail-header">
      <span className="provider-detail-name">{meta.label}</span>
      <span className={`provider-detail-dot ${status === 'Offline' || status === 'Pending' ? 'offline' : ''}`} />
      <span className="provider-detail-spacer" />
      <span className="provider-detail-status">{plan || status}</span>
    </div>
  );
}

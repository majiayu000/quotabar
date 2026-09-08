import { SERVICE_META } from '../services/service_meta';
import type { TrayServiceName } from '../services/tray_visibility';

interface ProviderSetupProps {
  service: TrayServiceName;
  onRetry: () => void;
  loading?: boolean;
}

export default function ProviderSetup({ service, onRetry, loading = false }: ProviderSetupProps) {
  return (
    <div className="provider-setup">
      <p>{SERVICE_META[service].setupHint}</p>
      <button type="button" className="retry-btn" onClick={onRetry} disabled={loading}>
        {loading ? 'Checking…' : 'Check connection'}
      </button>
    </div>
  );
}

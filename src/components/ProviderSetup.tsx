import { localizeLabel, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { SERVICE_META } from '../services/service_meta';
import type { TrayServiceName } from '../services/tray_visibility';

interface ProviderSetupProps {
  service: TrayServiceName;
  onRetry: () => void;
  loading?: boolean;
}

export default function ProviderSetup({ service, onRetry, loading = false }: ProviderSetupProps) {
  useLocale();
  return (
    <div className="provider-setup">
      <p>{localizeLabel(SERVICE_META[service].setupHint)}</p>
      <button type="button" className="retry-btn" onClick={onRetry} disabled={loading}>
        {loading ? t("Checking…") : t("Check connection")}
      </button>
    </div>
  );
}

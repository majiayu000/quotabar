import { workspaceCopy } from '../utils/quota_format';
import { SERVICE_META } from '../services/service_meta';
import type { TrayServiceName } from '../services/tray_visibility';

interface ProviderDetailHeaderProps {
  service: TrayServiceName;
  label?: string;
  status: string;
  plan?: string;
  usedPercent?: number | null;
  usageLabel?: string;
  tone?: 'online' | 'offline' | 'pending' | 'error';
}

function inferTone(status: string): NonNullable<ProviderDetailHeaderProps['tone']> {
  const normalized = status.toLowerCase();
  if (normalized.includes('error') || normalized.includes('unavailable')) return 'error';
  if (normalized.includes('offline') || normalized.includes('not connected')) return 'offline';
  if (normalized.includes('pending') || normalized.includes('checking') || normalized.includes('stale')) return 'pending';
  return 'online';
}

export default function ProviderDetailHeader({
  service,
  label,
  status,
  plan,
  usedPercent,
  usageLabel,
  tone = inferTone(status),
}: ProviderDetailHeaderProps) {
  const meta = SERVICE_META[service];
  const usage = typeof usedPercent === 'number' && Number.isFinite(usedPercent)
    ? `${usageLabel ? `${usageLabel} · ` : ''}${Math.round(usedPercent)}% ${workspaceCopy('used', '已使用')}`
    : null;

  return (
    <div className="provider-detail-header">
      <div className="provider-detail-identity">
        <span className="provider-detail-name">{label ?? meta.label}</span>
        <span className={`provider-detail-dot ${tone}`} aria-hidden="true" />
        <span className="provider-detail-state">{status === 'Connected' ? workspaceCopy(status, '已连接') : status === 'Offline' ? workspaceCopy(status, '未连接') : status}</span>
      </div>
      <span className="provider-detail-spacer" />
      {(plan || usage) && (
        <div className="provider-detail-meta">
          {plan && <span className="provider-detail-plan">{plan}</span>}
          {plan && usage && <span className="provider-detail-divider" aria-hidden="true">·</span>}
          {usage && <span className="provider-detail-status">{usage}</span>}
        </div>
      )}
    </div>
  );
}

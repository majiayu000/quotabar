import { clampProgressValue, getProgressStyle } from '../utils/quota_format';

interface QuotaCardProps {
  label: string;
  percentage: number;
  resetsIn: string;
  pace?: string | null;
}

function getStatusColor(percentage: number): string {
  if (percentage >= 80) return 'critical';
  if (percentage >= 50) return 'warning';
  return 'good';
}

export default function QuotaCard({ label, percentage, resetsIn, pace }: QuotaCardProps) {
  const status = getStatusColor(percentage);

  return (
    <div className="quota-card">
      <div className="quota-header">
        <span className="quota-label">{label}</span>
        <span className="quota-percentage">{percentage}% used</span>
      </div>

      <div
        className="progress-bar"
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampProgressValue(percentage)}
        aria-valuetext={`${Math.round(percentage)}% used`}
      >
        <div
          className={`progress-fill ${status}`}
          style={getProgressStyle(percentage)}
        />
      </div>

      <div className="quota-footer">
        <span className="reset-text">{resetsIn ? `Resets in ${resetsIn}` : 'Reset time unavailable'}</span>
        <span className="reset-at-text" />
      </div>

      {pace && (
        <span className={`quota-pace ${percentage >= 50 ? 'warning' : ''}`}>{pace}</span>
      )}
    </div>
  );
}

import { getProgressStyle } from '../utils/quota_format';

interface QuotaCardProps {
  label: string;
  percentage: number;
  resetsIn: string;
  pace?: string | null;
  featured?: boolean;
}

function getStatusColor(percentage: number): string {
  if (percentage >= 80) return 'critical';
  if (percentage >= 50) return 'warning';
  return 'good';
}

export default function QuotaCard({ label, percentage, resetsIn, pace, featured = false }: QuotaCardProps) {
  const status = getStatusColor(percentage);

  return (
    <div className={`quota-card${featured ? ' featured' : ''}`}>
      <div className="quota-header">
        <span className="quota-label">{label}</span>
        <span className="quota-percentage">{percentage}%</span>
      </div>

      <div
        className="progress-bar"
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <div
          className={`progress-fill ${status}`}
          style={getProgressStyle(percentage)}
        />
      </div>

      <div className="quota-footer">
        <span className="reset-text">Resets in {resetsIn}</span>
        <span className="reset-at-text" />
      </div>

      {pace && (
        <span className={`quota-pace ${percentage >= 50 ? 'warning' : ''}`}>{pace}</span>
      )}
    </div>
  );
}

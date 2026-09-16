import { useLocale } from '../i18n/react';
import { t } from '../i18n';
import { remainingPercent, getRemainingProgressStyle } from '../utils/quota_format';

interface QuotaCardProps {
  label: string;
  percentage: number;
  resetsIn: string;
  pace?: string | null;
  featured?: boolean;
}

function getStatusColor(percentage: number): string {
  if (percentage >= 95) return 'critical';
  if (percentage >= 80) return 'warning';
  return 'good';
}

export default function QuotaCard({ label, percentage, resetsIn, pace, featured = false }: QuotaCardProps) {
  useLocale();
  const status = getStatusColor(percentage);

  return (
    <div className={`quota-card${featured ? ' featured' : ''}`}>
      <div className="quota-header">
        <span className="quota-label">{label}</span>
        <span className="quota-value">{t("{p0}% remaining", { p0: remainingPercent(percentage) })}</span>
      </div>

      <div
        className="progress-bar"
        role="progressbar"
        aria-label={t("{p0} remaining quota", { p0: label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remainingPercent(percentage)}
        aria-valuetext={t("{p0}% remaining", { p0: remainingPercent(percentage) })}
      >
        <div
          className={`progress-fill ${status}`}
          style={getRemainingProgressStyle(percentage)}
        />
      </div>

      <div className="reset-time">
        <span className="reset-text">{t("Resets in")}{" "}{resetsIn}</span>
        <span className="reset-at-text" />
      </div>

      {pace && (
        <span className={`quota-pace ${percentage >= 50 ? 'warning' : ''}`}>{pace}</span>
      )}
    </div>
  );
}

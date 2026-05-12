import type { CSSProperties } from 'react';

interface QuotaCardProps {
  label: string;
  percentage: number;
  resetsIn: string;
}

function getStatusColor(percentage: number): string {
  if (percentage >= 80) return 'critical';
  if (percentage >= 50) return 'warning';
  return 'good';
}

function getStatusLabel(percentage: number): string {
  if (percentage >= 80) return 'Critical';
  if (percentage >= 50) return 'Warning';
  return 'Good';
}

function getProgressStyle(percentage: number): CSSProperties {
  const clamped = Math.min(Math.max(percentage, 0), 100);
  return {
    '--progress-scale': String(clamped / 100),
  } as CSSProperties;
}

export default function QuotaCard({ label, percentage, resetsIn }: QuotaCardProps) {
  const status = getStatusColor(percentage);
  const statusLabel = getStatusLabel(percentage);

  return (
    <div className="quota-card">
      <div className="quota-header">
        <span className="quota-label">{label}</span>
        <div className="quota-status">
          <span className={`status-badge ${status}`}>{statusLabel}</span>
          <span className="quota-percentage">{percentage}%</span>
        </div>
      </div>

      <div className="progress-bar">
        <div
          className={`progress-fill ${status}`}
          style={getProgressStyle(percentage)}
        />
      </div>

      <div className="quota-footer">
        <span className="reset-icon">↻</span>
        <span className="reset-text">Resets in {resetsIn}</span>
      </div>
    </div>
  );
}

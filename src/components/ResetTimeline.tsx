import type { QuotaWindowSummary } from '../services/provider_summary';
import { sortUpcomingResets } from '../services/provider_summary';

interface ResetTimelineProps {
  windows: QuotaWindowSummary[];
}

export default function ResetTimeline({ windows }: ResetTimelineProps) {
  const upcoming = sortUpcomingResets(windows).slice(0, 4);
  if (upcoming.length === 0) return null;

  return (
    <div className="section">
      <div className="section-title">Upcoming resets</div>
      <div className="reset-timeline">
        {upcoming.map((window) => (
          <div className="reset-timeline-row" key={`${window.provider}-${window.label}-${window.resetAtMs}`}>
            <span>{window.label}</span>
            <strong>{window.resetLabel}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

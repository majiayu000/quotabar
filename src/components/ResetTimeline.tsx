import type { QuotaWindowSummary } from '../services/provider_summary';
import { sortUpcomingResets } from '../services/provider_summary';
import { SERVICE_META } from '../services/service_meta';

interface ResetTimelineProps {
  windows: QuotaWindowSummary[];
}

export default function ResetTimeline({ windows }: ResetTimelineProps) {
  const now = Date.now();
  const upcoming = sortUpcomingResets(windows, now).slice(0, 5);
  if (upcoming.length === 0) return null;

  return (
    <div className="section">
      <div className="section-title">Upcoming resets</div>
      <div className="timeline-card">
        {upcoming.map((window) => {
          const hours = window.resetAtMs == null ? 0 : Math.max(0, (window.resetAtMs - now) / 3_600_000);
          const left = Math.min((hours / 168) * 100, 99);
          const over = hours > 168;
          return (
          <div
            className="timeline-row"
            key={`${window.provider}-${window.label}-${window.resetAtMs}`}
            style={{ opacity: over ? 0.55 : 1 }}
          >
            <span className="timeline-name">
              <span className="timeline-dot" style={{ background: SERVICE_META[window.provider].accent }} />
              <span>{`${window.providerLabel} · ${window.label}`}</span>
            </span>
            <span className="timeline-track">
              <span className="timeline-mark" style={{ left: `${left}%`, background: SERVICE_META[window.provider].accent }} />
            </span>
            <span className="timeline-time">{window.resetLabel}</span>
          </div>
          );
        })}
        <div className="timeline-scale">
          <span>Now</span>
          <span>+7d</span>
        </div>
      </div>
    </div>
  );
}

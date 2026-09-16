import { localizeLabel, getLocale, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { ProviderSummary, QuotaWindowSummary } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';
import type { QuotaDisplay } from '../services/quota_display';
import { formatResetTime, getProgressStyle, remainingPercent } from '../utils/quota_format';
import ProviderIcon from './ProviderIcon';
import ProviderSetup from './ProviderSetup';
import { quotaRecovery } from './QuotaRecovery';

function windowName(label: string): string {
  return label === '5h' ? t("5-hour quota") : localizeLabel(label);
}

function isWeekly(window: QuotaWindowSummary): boolean {
  return window.label === 'Weekly' || window.label.endsWith('7-day') || window.label === '7-day usage' || window.label === 'Weekly pool';
}


export default function QuotaOverview({ summaries, windows, display, onProviderSelect, onRefresh, onSettings }: {
  summaries: ProviderSummary[];
  windows: QuotaWindowSummary[];
  display: QuotaDisplay;
  onProviderSelect: (provider: TrayServiceName) => void;
  onRefresh: (provider: TrayServiceName) => void;
  onSettings: () => void;
}) {
  useLocale();
  // Reset copy continues to advance while the popover is open, independently of polling.
  const [, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const caption = t("Remaining");
  return <div className="quota-overview" aria-label={t("Account quota overview")}>
    {summaries.map((summary) => {
      const providerWindows = windows.filter((window) => window.provider === summary.id && Number.isFinite(window.usedPercent));
      // Visibility never changes which limit is most constrained.
      const headline = providerWindows.reduce<QuotaWindowSummary | undefined>((current, window) =>
        !current || window.usedPercent > current.usedPercent ? window : current, undefined);
      const used = headline?.usedPercent ?? (Number.isFinite(summary.usedPercent) ? summary.usedPercent : null);
      const percentage = used == null ? null : remainingPercent(used);
      const visibleWindows = providerWindows.filter((window) => display.weekly || !isWeekly(window));
      const recovery = quotaRecovery(summary.id, summary.readState?.error);
      const stale = Boolean(summary.failed || recovery);
      const readingAt = summary.lastSuccessAt ?? summary.readState?.readAt;
      return <section className={`quota-account${stale ? ' is-stale' : ''}`} key={summary.id} aria-label={t("{p0} quota", { p0: summary.label })}>
        <header className="quota-account-header">
          <h2>{summary.label}</h2>
          <button type="button" onClick={() => onProviderSelect(summary.id)} aria-label={t("View {p0} details", { p0: summary.label })}>{t("Details")}<span aria-hidden="true">›</span></button>
        </header>
        <div className="quota-account-reading" style={{ '--quota-color': used == null ? 'var(--sub)' : getProgressStyle(used).background } as CSSProperties}>
          <div className="quota-dial" aria-hidden="true">
            <svg viewBox="0 0 80 80" className="quota-dial-track">
              <circle cx="40" cy="40" r="34" />
              {percentage !== null && percentage > 0 && <circle className="quota-dial-fill" cx="40" cy="40" r="34" pathLength="100" strokeDasharray={`${percentage} 100`} />}
            </svg>
            <ProviderIcon service={summary.id} className="quota-dial-icon" />
          </div>
          <div className="quota-account-value">
            <strong>{percentage === null ? '—' : `${percentage}%`}</strong>
            <span>{percentage === null ? summary.loading ? t("Loading quota…") : t("No quota data") : t("Remaining quota")}</span>
            {headline && <small>{windowName(headline.label)}{providerWindows.length > 1 ? t(" · Closest to limit") : ''}</small>}
          </div>
        </div>
        {visibleWindows.length > 0 && <div className="quota-account-windows">
          {visibleWindows.map((window) => {
            const value = remainingPercent(window.usedPercent);
            const reset = window.resetAtMs ? formatResetTime(window.resetAtMs / 1000, { expiredLabel: t("Resetting soon") }) : null;
            return <div className="quota-window" key={window.label}>
              <div className="quota-window-label"><span>{windowName(window.label)}</span><span>{caption} {value}%</span></div>
              <div className="quota-window-track" role="progressbar" aria-label={t("{p0} {p1} {p2} quota", { p0: summary.label, p1: windowName(window.label), p2: caption })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${caption} ${value}%${stale ? t(", last known data") : ''}`}>
                <span style={{ width: `${value}%`, background: getProgressStyle(window.usedPercent).background }} />
              </div>
              {reset && <small className="quota-window-reset">{window.resetAtMs! <= Date.now() ? reset : t("Resets in {p0}", { p0: reset })}</small>}
            </div>;
          })}
        </div>}
        {stale && <div className="quota-account-notice" role="status">
          <span>{recovery?.title ?? t("Quota update failed")}{percentage !== null ? t(" · Showing stale data") : ''}</span>
          {readingAt != null && <small>{t("Last successful read")}{new Date(readingAt).toLocaleString(getLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>}
          <button type="button" onClick={() => onProviderSelect(summary.id)}>{t("View cause and recovery steps ›")}</button>
        </div>}
        {percentage === null && !summary.loading && !summary.connected && !stale && <ProviderSetup service={summary.id} loading={false} onRetry={() => onRefresh(summary.id)} />}
      </section>;
    })}
    <button type="button" className="quota-manage-accounts" onClick={onSettings}>{t("Manage visible accounts")}<span aria-hidden="true">›</span></button>
  </div>;
}

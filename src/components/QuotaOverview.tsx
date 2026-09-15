import { useEffect, useState, type CSSProperties } from 'react';
import type { ProviderSummary, QuotaWindowSummary } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';
import type { QuotaDisplay } from '../services/quota_display';
import { formatResetTime, getProgressStyle, remainingPercent } from '../utils/quota_format';
import ProviderIcon from './ProviderIcon';
import ProviderSetup from './ProviderSetup';
import { quotaRecovery } from './QuotaRecovery';

function windowName(label: string): string {
  if (label === '5-hour usage' || label === '5h') return '5 小时额度';
  if (label === '7-day usage' || label === 'Weekly') return '每周额度';
  return label.replace('7-day', '每周').replace('Usage limit', '额度');
}

function isWeekly(window: QuotaWindowSummary): boolean {
  return /7-day|Weekly|每周/.test(window.label);
}


export default function QuotaOverview({ summaries, windows, display, onProviderSelect, onRefresh, onSettings }: {
  summaries: ProviderSummary[];
  windows: QuotaWindowSummary[];
  display: QuotaDisplay;
  onProviderSelect: (provider: TrayServiceName) => void;
  onRefresh: (provider: TrayServiceName) => void;
  onSettings: () => void;
}) {
  // Reset copy continues to advance while the popover is open, independently of polling.
  const [, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const caption = '剩余';
  return <div className="quota-overview" aria-label="账户额度总览">
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
      return <section className={`quota-account${stale ? ' is-stale' : ''}`} key={summary.id} aria-label={`${summary.label}额度`}>
        <header className="quota-account-header">
          <h2>{summary.label}</h2>
          <button type="button" onClick={() => onProviderSelect(summary.id)} aria-label={`查看 ${summary.label} 详情`}>详情 <span aria-hidden="true">›</span></button>
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
            <span>{percentage === null ? summary.loading ? '正在读取额度…' : '暂无额度数据' : `${caption}额度`}</span>
            {headline && <small>{windowName(headline.label)}{providerWindows.length > 1 ? ' · 最接近用尽' : ''}</small>}
          </div>
        </div>
        {visibleWindows.length > 0 && <div className="quota-account-windows">
          {visibleWindows.map((window) => {
            const value = remainingPercent(window.usedPercent);
            const reset = window.resetAtMs ? formatResetTime(window.resetAtMs / 1000, { expiredLabel: '即将重置' }) : null;
            return <div className="quota-window" key={window.label}>
              <div className="quota-window-label"><span>{windowName(window.label)}</span><span>{caption} {value}%</span></div>
              <div className="quota-window-track" role="progressbar" aria-label={`${summary.label} ${windowName(window.label)}${caption}额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${caption} ${value}%${stale ? '，上次读取的数据' : ''}`}>
                <span style={{ width: `${value}%`, background: getProgressStyle(window.usedPercent).background }} />
              </div>
              {reset && <small className="quota-window-reset">{reset === '即将重置' ? reset : `${reset.replace(/d/g, ' 天 ').replace(/h/g, ' 小时 ').replace(/m/g, ' 分钟').trim()}后重置`}</small>}
            </div>;
          })}
        </div>}
        {stale && <div className="quota-account-notice" role="status">
          <span>{recovery?.title ?? '额度更新失败'}{percentage !== null ? ' · 显示旧数据' : ''}</span>
          {readingAt != null && <small>最近成功读取 {new Date(readingAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>}
          <button type="button" onClick={() => onProviderSelect(summary.id)}>查看原因与恢复方式 ›</button>
        </div>}
        {percentage === null && !summary.loading && !summary.connected && !stale && <ProviderSetup service={summary.id} loading={false} onRetry={() => onRefresh(summary.id)} />}
      </section>;
    })}
    <button type="button" className="quota-manage-accounts" onClick={onSettings}>管理显示的账户 <span aria-hidden="true">›</span></button>
  </div>;
}

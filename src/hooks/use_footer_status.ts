import { useEffect, useState } from 'react';
import { formatEventTime } from '../services/event_log';

export function useFooterStatus(
  windowVisible: boolean,
  activeLoading: boolean,
  lastUpdatedAt: number | null,
  failed = false,
): { footerStatus: string; footerStatusTitle: string } {
  const [, setStatusTick] = useState(0);

  useEffect(() => {
    if (!windowVisible) return;
    const interval = setInterval(() => setStatusTick((tick) => tick + 1), 30 * 1000);
    return () => clearInterval(interval);
  }, [windowVisible]);

  return {
    footerStatus: activeLoading
      ? '正在刷新…'
      : lastUpdatedAt != null
        ? `${failed ? '旧数据 · ' : ''}最近成功读取 ${formatEventTime(new Date(lastUpdatedAt).toISOString())}`
        : failed ? '额度不可用 · 请重试' : '尚未成功读取额度',
    footerStatusTitle: lastUpdatedAt != null
      ? `最近成功读取 ${new Date(lastUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : '尚未成功读取额度',
  };
}

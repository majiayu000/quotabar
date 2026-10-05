import { useLocale } from '../i18n/react';
import { formatForecastText, type QuotaForecast } from '../services/quota_forecast';

/** Detail-row exhaustion estimate; renders nothing when there is no forecast. */
export default function QuotaForecastLine({ forecast }: { forecast: QuotaForecast | undefined }) {
  useLocale();
  const text = formatForecastText(forecast);
  if (!forecast || !text) return null;
  return <span className={`quota-pace${forecast.kind === 'before_reset' ? ' warning' : ''}`}>{text}</span>;
}

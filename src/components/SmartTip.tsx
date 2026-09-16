import { useLocale } from '../i18n/react';
import { t } from '../i18n';
interface SmartTipProps {
  message: string | null;
}

export default function SmartTip({ message }: SmartTipProps) {
  useLocale();
  if (!message) return null;
  return (
    <div className="smart-tip">
      <span className="smart-tip-label">{t("Tip")}</span>
      <span>{message}</span>
    </div>
  );
}

import { getLocale, t, localizeLabel } from '../i18n';
import { useLocale } from '../i18n/react';
import { useEffect, useState } from 'react';
import type { ProviderReadState } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';
import { isClaudeAuthError } from '../services/app_state';

export function quotaRecovery(provider: TrayServiceName, error?: string | null) {
  if (!error) return null;
  if (error.includes('429')) return {
    title: t("Quota temporarily unavailable"),
    description: provider === 'grok'
      ? t("The provider is rate limiting quota requests. They will retry on the refresh schedule.")
      : t("The provider is rate limiting quota requests. Automatic refresh is paused; retry manually after the wait."),
    command: null,
  };
  if (provider === 'grok' && /session expired|not configured|authentication failed/i.test(error)) return {
    requiresLogin: true,
    title: /expired/i.test(error) ? t("Session expired") : /authentication failed/i.test(error) ? t("Authentication failed; check sign-in") : t("Sign in first"),
    description: t("Sign in to Grok in Terminal. QuotaBar will reconnect automatically, or select “Signed in, check again” to check now. Existing local usage records remain available."),
    command: 'grok login',
  };
  if (provider === 'claude' && isClaudeAuthError(error)) return {
    requiresLogin: true,
    title: /expired|invalid|401|403/i.test(error) ? t("Sign in again") : t("Sign in first"),
    description: t("Open Claude Code and sign in, then select “Signed in, check again”. Existing local usage records remain available."),
    command: null,
  };
  return { title: t("Could not read quota"), description: t("Latest quota is unavailable. Retry later or expand diagnostics for the cause."), command: null };
}

export function useQuotaCooldown(retryAt?: number | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!retryAt || retryAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.max(retryAt - Date.now(), 0) + 20, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [retryAt, now]);
  return Boolean(retryAt && retryAt > now);
}

export default function QuotaRecovery({ provider, read, hasData = false }: {
  provider: TrayServiceName; read?: ProviderReadState; hasData?: boolean;
}) {
  useLocale();
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const recovery = quotaRecovery(provider, read?.error);
  const cooling = useQuotaCooldown(read?.retryAt);
  if (!recovery) return null;
  return <div className="workspace-quota-recovery">
    <div role="status"><strong>{recovery.title}</strong><p>{recovery.description}</p>
      {cooling && <p className="workspace-retry-time">{t("Requests paused · Retry after {time}", { time: new Date(read!.retryAt!).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) })}</p>}
      {hasData && <p>{t("Showing the last successful read, which may be stale.")}</p>}
    </div>
    {recovery.command && <div className="workspace-login-command"><code>{recovery.command}</code><button onClick={async () => {
      try { await navigator.clipboard.writeText(recovery.command!); setCopied(true); setCopyError(null); }
      catch { setCopyError("Could not copy. Select and copy the command manually."); }
    }}>{copied ? t("Copied") : t("Copy command")}</button></div>}
    {copyError && <p role="alert">{localizeLabel(copyError)}</p>}
    <details className="workspace-quota-diagnostic"><summary>{t("Diagnostics")}</summary><p>{read?.error}</p></details>
  </div>;
}

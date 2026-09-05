import { useEffect, useState } from 'react';
import type { ProviderReadState } from '../services/provider_summary';
import type { TrayServiceName } from '../services/tray_visibility';
import { isClaudeAuthError } from '../services/app_state';

export function quotaRecovery(provider: TrayServiceName, error?: string | null) {
  if (!error) return null;
  if (error.includes('429')) return {
    title: '额度暂时无法更新',
    description: '服务商暂时限制了额度查询。自动刷新已停止，请在等待结束后手动重试。',
    command: null,
  };
  if (provider === 'grok' && /session expired|not configured/i.test(error)) return {
    title: /expired/i.test(error) ? '登录已过期' : '请先登录',
    description: '在终端完成 Grok 登录，再点击“我已登录，重新检测”。已有的本地用量记录仍可查看。',
    command: 'grok login',
  };
  if (provider === 'claude' && isClaudeAuthError(error)) return {
    title: /expired|invalid|401|403/i.test(error) ? '需要重新登录' : '请先登录',
    description: '打开 Claude Code，完成登录后，点击“我已登录，重新检测”。已有的本地用量记录仍可查看。',
    command: null,
  };
  return { title: '额度读取失败', description: '暂时无法读取最新额度。可以稍后重试，或展开诊断详情查看原因。', command: null };
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
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const recovery = quotaRecovery(provider, read?.error);
  const cooling = useQuotaCooldown(read?.retryAt);
  if (!recovery) return null;
  return <div className="workspace-quota-recovery">
    <div role="status"><strong>{recovery.title}</strong><p>{recovery.description}</p>
      {cooling && <p className="workspace-retry-time">已暂停请求 · {new Date(read!.retryAt!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 后可重试</p>}
      {hasData && <p>当前显示上次成功读取的数据，可能已过时。</p>}
    </div>
    {recovery.command && <div className="workspace-login-command"><code>{recovery.command}</code><button onClick={async () => {
      try { await navigator.clipboard.writeText(recovery.command!); setCopied(true); setCopyError(null); }
      catch { setCopyError('复制失败，请手动选择并复制这条命令。'); }
    }}>{copied ? '已复制' : '复制命令'}</button></div>}
    {copyError && <p role="alert">{copyError}</p>}
    <details className="workspace-quota-diagnostic"><summary>诊断详情</summary><p>{read?.error}</p></details>
  </div>;
}

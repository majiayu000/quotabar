import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface QuickActionsProps {
  statusText: string;
  paused: boolean;
  onTogglePause: () => void;
  onOpenUsagePage: () => void;
}

const COPY_FEEDBACK_MS = 1500;

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: '6px',
  padding: '8px 2px 4px',
};

const quickBtnStyle: CSSProperties = {
  flex: 1,
  textAlign: 'center',
  padding: '6px 0',
  borderRadius: '8px',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
  background: 'var(--card,rgba(255,255,255,0.5))',
  boxShadow: '0 0 0 0.5px var(--line,rgba(0,0,0,0.06)), inset 0 0.5px 0 var(--inner,rgba(255,255,255,0.55))',
  border: 0,
  appearance: 'none',
  color: 'var(--text)',
  fontFamily: 'inherit',
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // WKWebView can reject the async clipboard API; fall back to execCommand.
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function QuickActions({
  statusText,
  paused,
  onTogglePause,
  onOpenUsagePage,
}: QuickActionsProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
  }, []);

  const handleCopyStatus = async () => {
    const ok = await copyToClipboard(statusText);
    setCopyState(ok ? 'copied' : 'failed');
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
  };

  const copyLabel = copyState === 'copied'
    ? 'Copied ✓'
    : copyState === 'failed'
      ? 'Copy failed'
      : 'Copy status';

  return (
    <div className="quick-actions" style={rowStyle}>
      <button
        type="button"
        className="quick-action-btn"
        style={quickBtnStyle}
        onClick={handleCopyStatus}
        title="Copy current usage summary"
      >
        {copyLabel}
      </button>
      <button
        type="button"
        className="quick-action-btn"
        style={quickBtnStyle}
        onClick={onTogglePause}
        title={paused ? 'Resume automatic refresh' : 'Pause automatic refresh'}
        aria-pressed={paused}
      >
        {paused ? 'Resume polling' : 'Pause polling'}
      </button>
      <button
        type="button"
        className="quick-action-btn"
        style={quickBtnStyle}
        onClick={onOpenUsagePage}
        title="Open provider usage page"
      >
        Usage page ↗
      </button>
    </div>
  );
}

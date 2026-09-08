import type { TrayServiceName } from './tray_visibility';

export interface ServiceMeta {
  id: TrayServiceName;
  label: string;
  shortLabel: string;
  initials: string;
  trayLabel: string;
  accent: string;
  connectedHint?: string;
  disconnectedHint: string;
  setupHint: string;
}

export const SERVICES: TrayServiceName[] = ['claude', 'codex', 'cursor', 'grok', 'antigravity'];

export const SERVICE_META: Record<TrayServiceName, ServiceMeta> = {
  claude: {
    id: 'claude',
    setupHint: 'Sign in with Claude Code using claude login in Terminal, then check again. If your session expired, sign in again.',
    label: 'Claude',
    shortLabel: 'Claude',
    initials: 'C',
    trayLabel: 'Claude Tray',
    accent: '#d97757',
    disconnectedHint: 'Requires Claude Code login',
  },
  codex: {
    id: 'codex',
    setupHint: 'Open Codex and sign in, or run codex login in Terminal, then check again.',
    label: 'Codex',
    shortLabel: 'Codex',
    initials: 'Co',
    trayLabel: 'Codex Tray',
    accent: '#267BB2',
    disconnectedHint: 'Requires Codex App or CLI login',
  },
  cursor: {
    id: 'cursor',
    setupHint: 'Open Cursor and sign in to your account, then check again.',
    label: 'Cursor',
    shortLabel: 'Cursor',
    initials: 'Cu',
    trayLabel: 'Cursor Tray',
    accent: '#5B5BD6',
    disconnectedHint: 'Requires Cursor sign-in or CURSOR_SESSION_TOKEN',
  },
  grok: {
    id: 'grok',
    setupHint: 'Run grok login in Terminal to sign in to Grok Build, then check again.',
    label: 'Grok',
    shortLabel: 'Grok',
    initials: 'Gk',
    trayLabel: 'Grok Tray',
    accent: '#A1A1AA',
    disconnectedHint: 'Requires Grok Build login',
  },
  antigravity: {
    id: 'antigravity',
    setupHint: 'Quota tracking is not available yet. Detecting an Antigravity installation does not provide usage limits.',
    label: 'Antigravity',
    shortLabel: 'Anti',
    initials: 'Ag',
    trayLabel: 'Antigravity Tray',
    accent: '#0A84FF',
    connectedHint: 'Preview',
    disconnectedHint: 'Quota tracking pending - see panel',
  },
};

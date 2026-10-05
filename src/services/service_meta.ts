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
  /** Provider code stays, but it is left out of every user-facing list and tray. */
  hidden?: boolean;
}

/** Every provider the code knows about, including hidden ones. Use for complete state maps. */
export const ALL_SERVICES: TrayServiceName[] = ['claude', 'codex', 'cursor', 'grok', 'antigravity'];

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
    // Hidden until real quota tracking exists; it would only ever show a placeholder.
    hidden: true,
  },
};

/** Providers shown to users: switcher, overview, settings, favorites and trays. */
export const SERVICES: TrayServiceName[] = ALL_SERVICES.filter((service) => !SERVICE_META[service].hidden);

/** True for a known provider id that is currently hidden, so stale saved preferences can be ignored. */
export function isHiddenService(value: unknown): boolean {
  return ALL_SERVICES.includes(value as TrayServiceName) && !SERVICES.includes(value as TrayServiceName);
}

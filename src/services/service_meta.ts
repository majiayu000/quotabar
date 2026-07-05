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
}

export const SERVICES: TrayServiceName[] = ['claude', 'codex', 'cursor', 'antigravity'];

export const SERVICE_META: Record<TrayServiceName, ServiceMeta> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    shortLabel: 'Claude',
    initials: 'C',
    trayLabel: 'Claude Tray',
    accent: '#d97757',
    disconnectedHint: 'Requires Claude Code login',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    shortLabel: 'Codex',
    initials: 'Co',
    trayLabel: 'Codex Tray',
    accent: '#10A37F',
    disconnectedHint: 'Requires Codex App or CLI login',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    shortLabel: 'Cursor',
    initials: 'Cu',
    trayLabel: 'Cursor Tray',
    accent: '#5B5BD6',
    disconnectedHint: 'Requires Cursor sign-in or CURSOR_SESSION_TOKEN',
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity',
    shortLabel: 'Anti',
    initials: 'Ag',
    trayLabel: 'Antigravity Tray',
    accent: '#0A84FF',
    connectedHint: 'Preview',
    disconnectedHint: 'Quota tracking pending - see panel',
  },
};

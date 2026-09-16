import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceQuotaCard } from '../src/components/OverviewPanel';
import { quotaRecovery } from '../src/components/QuotaRecovery';
import type { ProviderSummary } from '../src/services/provider_summary';

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T09:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const provider = (id: 'claude' | 'grok', error: string, retryAt?: number): ProviderSummary => ({
  id, label: id, shortLabel: id, initials: '', accent: '', connected: false,
  loading: false, usedPercent: null, statusText: 'Offline', readState: { error, readAt: null, retryAt },
});

it('shows a cooldown instead of disconnected, hides raw errors in diagnostics, and re-enables retry at the deadline', async () => {
  const refresh = vi.fn();
  await act(async () => { renderer = create(createElement(WorkspaceQuotaCard, { provider: provider('claude', 'API error: 429 Too Many Requests', Date.now() + 3_458_000), windows: [], onSelect: vi.fn(), onRefresh: refresh })); });
  const root = renderer!.root;
  expect(root.findByProps({ role: 'status' }).findByType('strong').children).toEqual(['Quota temporarily unavailable']);
  expect(root.findByProps({ role: 'status' }).findAllByType('p').map(node => node.children.join('')).join(' ')).not.toContain('429');
  const diagnostics = root.findByType('details');
  expect(diagnostics.props.open).not.toBe(true);
  expect(diagnostics.findByType('p').children).toEqual(['API error: 429 Too Many Requests']);
  expect(root.findAllByType('progress')).toHaveLength(0);
  const retry = root.findAllByType('button').find(node => node.children.includes('Waiting to retry'))!;
  expect(retry.props.disabled).toBe(true);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(3_458_100); });
  const ready = root.findAllByType('button').find(node => node.children.includes('Refresh quota'))!;
  expect(ready.props.disabled).toBe(false);
  await act(async () => { ready.props.onClick(); });
  expect(refresh).toHaveBeenCalledWith('claude');
});

it('offers the exact Grok login command and a post-login recheck, with copy failures visible', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('clipboard blocked'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const refresh = vi.fn();
  await act(async () => { renderer = create(createElement(WorkspaceQuotaCard, { provider: provider('grok', "Grok session expired. Run 'grok login', then click Refresh."), windows: [], onSelect: vi.fn(), onRefresh: refresh })); });
  const root = renderer!.root;
  expect(root.findByType('code').children).toEqual(['grok login']);
  expect(root.findByProps({ role: 'status' }).findByType('strong').children).toEqual(['Session expired']);
  await act(async () => { await root.findAllByType('button').find(node => node.children.includes('Copy command'))!.props.onClick(); });
  expect(writeText).toHaveBeenCalledWith('grok login');
  expect(root.findByProps({ role: 'alert' }).children).toEqual(['Could not copy. Select and copy the command manually.']);
  await act(async () => root.findAllByType('button').find(node => node.children.includes('Signed in, check again'))!.props.onClick());
  expect(refresh).toHaveBeenCalledWith('grok');
});

it('keeps the last quota visible with an explicit stale marker after throttling', async () => {
  await act(async () => { renderer = create(createElement(WorkspaceQuotaCard, { provider: { ...provider('claude', 'API error: 429 Too Many Requests', Date.now() + 1000), connected: true }, windows: [{ provider: 'claude', providerLabel: 'Claude', label: 'Weekly', usedPercent: 42 }], onSelect: vi.fn(), onRefresh: vi.fn() })); });
  expect(renderer!.root.findByType('progress').props.value).toBe(58);
  expect(renderer!.root.findByProps({ role: 'status' }).findAllByType('p').some(node => node.children.join('').includes('last successful read'))).toBe(true);
});

it('asks for Claude login and lets the user explicitly recheck without showing quota bars', async () => {
  const refresh = vi.fn();
  await act(async () => { renderer = create(createElement(WorkspaceQuotaCard, { provider: provider('claude', 'Claude OAuth token expired or invalid. Please re-login to Claude Code, then click Refresh.'), windows: [], onSelect: vi.fn(), onRefresh: refresh })); });
  const root = renderer!.root;
  expect(root.findByProps({ role: 'status' }).findByType('strong').children).toEqual(['Sign in again']);
  expect(root.findAllByType('progress')).toHaveLength(0);
  const retry = root.findAllByType('button').find(node => node.children.includes('Signed in, check again'))!;
  expect(retry.props.disabled).toBe(false);
  await act(async () => retry.props.onClick());
  expect(refresh).toHaveBeenCalledWith('claude');
});

it('distinguishes Grok local expiry from API auth rejection and describes automatic recovery', () => {
  expect(quotaRecovery('grok', 'Grok session expired.')?.title).toBe('Session expired');
  const rejected = quotaRecovery('grok', 'Grok authentication failed (401/403).');
  expect(rejected?.title).toBe('Authentication failed; check sign-in');
  expect(rejected?.command).toBe('grok login');
  expect(rejected?.description).toContain('reconnect automatically');
  expect(quotaRecovery('grok', 'Grok billing API error: 429')?.description).toContain('retry on the refresh schedule');
});

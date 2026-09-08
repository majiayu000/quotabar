import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceQuotaCard } from '../src/components/OverviewPanel';
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
  expect(root.findByProps({ role: 'status' }).findByType('strong').children).toEqual(['额度暂时无法更新']);
  expect(root.findByProps({ role: 'status' }).findAllByType('p').map(node => node.children.join('')).join(' ')).not.toContain('429');
  const diagnostics = root.findByType('details');
  expect(diagnostics.props.open).not.toBe(true);
  expect(diagnostics.findByType('p').children).toEqual(['API error: 429 Too Many Requests']);
  expect(root.findAllByType('progress')).toHaveLength(0);
  const retry = root.findAllByType('button').find(node => node.children.includes('等待重试'))!;
  expect(retry.props.disabled).toBe(true);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(3_458_100); });
  const ready = root.findAllByType('button').find(node => node.children.includes('刷新额度'))!;
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
  expect(root.findByProps({ role: 'status' }).findByType('strong').children).toEqual(['登录已过期']);
  await act(async () => { await root.findAllByType('button').find(node => node.children.includes('复制命令'))!.props.onClick(); });
  expect(writeText).toHaveBeenCalledWith('grok login');
  expect(root.findByProps({ role: 'alert' }).children).toEqual(['复制失败，请手动选择并复制这条命令。']);
  await act(async () => root.findAllByType('button').find(node => node.children.includes('我已登录，重新检测'))!.props.onClick());
  expect(refresh).toHaveBeenCalledWith('grok');
});

it('keeps the last quota visible with an explicit stale marker after throttling', async () => {
  await act(async () => { renderer = create(createElement(WorkspaceQuotaCard, { provider: { ...provider('claude', 'API error: 429 Too Many Requests', Date.now() + 1000), connected: true }, windows: [{ provider: 'claude', providerLabel: 'Claude', label: 'Weekly', usedPercent: 42 }], onSelect: vi.fn(), onRefresh: vi.fn() })); });
  expect(renderer!.root.findByType('progress').props.value).toBe(42);
  expect(renderer!.root.findByProps({ role: 'status' }).findAllByType('p').some(node => node.children.join('').includes('上次成功读取'))).toBe(true);
});

it('asks for Claude login and lets the user explicitly recheck without showing quota bars', async () => {
  const refresh = vi.fn();
  await act(async () => { renderer = create(createElement(WorkspaceQuotaCard, { provider: provider('claude', 'Claude OAuth token expired or invalid. Please re-login to Claude Code, then click Refresh.'), windows: [], onSelect: vi.fn(), onRefresh: refresh })); });
  const root = renderer!.root;
  expect(root.findByProps({ role: 'status' }).findByType('strong').children).toEqual(['需要重新登录']);
  expect(root.findAllByType('progress')).toHaveLength(0);
  const retry = root.findAllByType('button').find(node => node.children.includes('我已登录，重新检测'))!;
  expect(retry.props.disabled).toBe(false);
  await act(async () => retry.props.onClick());
  expect(refresh).toHaveBeenCalledWith('claude');
});

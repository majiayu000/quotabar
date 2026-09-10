import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import TabSwitcher from '../src/components/TabSwitcher';
import ActionButtons from '../src/components/ActionButtons';
import OverviewPanel from '../src/components/OverviewPanel';
import { backend } from '../src/services/backend';

vi.mock('../src/hooks/use_popover_window', () => ({ usePopoverWindow: () => false }));
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(backend, 'getQuota').mockResolvedValue({ connected: true, session: { used: 20, limit: 100, percentage: 20 } });
  vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true });
  vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({ connected: true, primary: { usedPercent: 30 } });
  vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({ connected: true, availableCount: 0, credits: [] });
  vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
  vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({ connected: true, percentage: 40 });
  vi.spyOn(backend, 'getGrokInfo').mockResolvedValue({ connected: true, percentage: 50 });
  vi.spyOn(backend, 'getAntigravityInfo').mockResolvedValue({ connected: false, status: 'pending' });
  vi.spyOn(backend, 'setDockVisibility').mockResolvedValue();
  vi.spyOn(backend, 'updateTrayIcon').mockResolvedValue();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => { renderer = create(<App />); });
}
function status(service: string) {
  return renderer!.root.findByType(OverviewPanel).props.summaries.find((item: { id: string }) => item.id === service);
}

describe('successful quota freshness', () => {
  it('keeps cost and timeline in the tray popover without add-service chrome', async () => {
    await mount();
    expect(renderer!.root.findByType(OverviewPanel).props.sections).toEqual({
      timeline: true,
      cost: true,
      trend: true,
      tips: true,
    });
    expect(renderer!.root.findByType(TabSwitcher).props).not.toHaveProperty('onAddService');
  });

  it('discovers connected services and keeps a failed service reachable', async () => {
    vi.mocked(backend.getCursorInfo).mockResolvedValue({ connected: false });
    await mount();
    expect(renderer!.root.findByType(TabSwitcher).props.summaries.map((item: { id: string }) => item.id)).toEqual(['claude', 'codex', 'grok']);
    vi.mocked(backend.getGrokInfo).mockRejectedValueOnce(new Error('Network unavailable'));
    await act(async () => renderer!.root.findByType(ActionButtons).props.onRefresh());
    expect(renderer!.root.findByType(TabSwitcher).props.summaries.map((item: { id: string }) => item.id)).toContain('grok');
  });

  it.each(['claude', 'codex', 'cursor', 'grok'])('keeps %s success time after a rejected refresh and recovers independently', async (service) => {
    await mount();
    const successAt = status(service).lastSuccessAt;
    expect(successAt).toBe(Date.now());
    vi.setSystemTime(Date.now() + 120_000);
    const request = { claude: backend.getQuota, codex: backend.getCodexRateLimits, cursor: backend.getCursorInfo, grok: backend.getGrokInfo }[service]!;
    vi.mocked(request).mockRejectedValueOnce(new Error('Network unavailable'));
    await act(async () => renderer!.root.findByType(TabSwitcher).props.onTabChange(service));
    await act(async () => renderer!.root.findByType(ActionButtons).props.onRefresh());
    expect(renderer!.root.findByType(ActionButtons).props.statusText).toBe('旧数据 · 最近成功读取 2m ago');
    await act(async () => renderer!.root.findByType(TabSwitcher).props.onTabChange('all'));
    expect(status(service).lastSuccessAt).toBe(successAt);
    expect(status(service).failed).toBe(true);
    await act(async () => renderer!.root.findByType(TabSwitcher).props.onTabChange(service));
    await act(async () => renderer!.root.findByType(ActionButtons).props.onRefresh());
    expect(renderer!.root.findByType(ActionButtons).props.statusText).toBe('最近成功读取 now');
    await act(async () => renderer!.root.findByType(TabSwitcher).props.onTabChange('all'));
    expect(status(service).failed).toBe(false);
    expect(status(service).lastSuccessAt).toBe(Date.now());
    expect(status(service === 'claude' ? 'cursor' : 'claude').lastSuccessAt).toBe(successAt);
  });

  it('keeps a deliberately opened service visible before detection completes', async () => {
    vi.mocked(backend.getCursorInfo).mockResolvedValue({ connected: false });
    await mount();
    await act(async () => renderer!.root.findByType(OverviewPanel).props.onProviderSelect('cursor'));
    expect(renderer!.root.findByType(TabSwitcher).props.activeTab).toBe('cursor');
    expect(renderer!.root.findByType(TabSwitcher).props.summaries.map((item: { id: string }) => item.id)).toContain('cursor');
  });

  it('does not call a disconnected or error payload a successful update', async () => {
    vi.mocked(backend.getQuota).mockResolvedValue({ connected: true, error: 'Cached data', session: { used: 20, limit: 100, percentage: 20 } });
    vi.mocked(backend.getCursorInfo).mockResolvedValue({ connected: false });
    await mount();
    expect(status('claude')).toMatchObject({ failed: true, lastSuccessAt: null });
    expect(status('cursor')).toMatchObject({ failed: true, lastSuccessAt: null });
  });
});

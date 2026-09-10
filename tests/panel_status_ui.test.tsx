import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AntigravityPanel from '../src/components/AntigravityPanel';
import ClaudePanel from '../src/components/ClaudePanel';
import CodexPanel from '../src/components/CodexPanel';
import CursorPanel from '../src/components/CursorPanel';
import GrokPanel from '../src/components/GrokPanel';
import OverviewPanel from '../src/components/OverviewPanel';
import { backend } from '../src/services/backend';

const hiddenSections = { timeline: false, cost: false, trend: false, tips: false };

function renderedText(renderer: ReactTestRenderer): string {
  expect(renderer.root.findAllByProps({ className: 'provider-detail-header' })).toHaveLength(0);
  return JSON.stringify(renderer.toJSON());
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

describe('provider status UI', () => {
  it('opens overview on remaining quota without a connection-count header', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(OverviewPanel, {
        summaries: [
          { id: 'claude', label: 'Claude', shortLabel: 'Claude', initials: 'C', accent: '#000', connected: true, loading: false, usedPercent: 82, statusText: '82% used' },
          { id: 'codex', label: 'Codex', shortLabel: 'Codex', initials: 'Co', accent: '#000', connected: false, loading: false, usedPercent: null, statusText: 'Offline' },
        ],
        mostConstrained: [{ provider: 'claude', providerLabel: 'Claude', label: '7-day usage', usedPercent: 82 }],
        upcomingResets: [],
        costRefreshKey: 0,
        onProviderSelect: vi.fn(),
        sections: hiddenSections,
      }));
    });

    const text = renderedText(renderer);
    expect(text).toContain('剩余额度');
    const progress = renderer.root.findByProps({ role: 'progressbar' });
    expect(progress.props['aria-valuenow']).toBe(18);
    expect(progress.props['aria-valuetext']).toBe('18% remaining');
    expect(progress.findByProps({ className: 'progress-fill' }).props.style.width).toBe('18%');
    expect(text).toContain('Claude · 7-day usage');
    expect(text).not.toContain('Overview');
    expect(text).not.toContain('connected');
    expect(text).not.toContain('Claude, Codex, Cursor');
  });

  it('keeps last-known Claude data visible after a refresh error', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(ClaudePanel, {
        quota: {
          connected: true,
          weeklyTotal: { used: 41, limit: 100, percentage: 41 },
        },
        loading: false,
        error: 'Refresh failed',
        windowVisible: true,
        costRefreshKey: 0,
        onRetry: vi.fn(),
        sections: hiddenSections,
      }));
    });

    const text = renderedText(renderer);
    expect(text).toContain('Refresh failed');
    expect(text).toContain('当前显示上次成功读取的数据');
    expect(text).toContain('41%');
  });

  it('shows a connected Antigravity state without an offline contradiction', async () => {
    vi.spyOn(backend, 'getAntigravityInfo').mockResolvedValue({ connected: true, status: 'preview' });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(AntigravityPanel, { autoRefreshIntervalMs: 0 }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('The CLI session is available');
    expect(text).toContain('Antigravity is connected');
    expect(text).not.toContain('Antigravity is not connected');
    expect(text).not.toContain('⧉');
    await act(async () => renderer.unmount());
  });

  it('treats the Antigravity placeholder as preview rather than a refresh error', async () => {
    vi.spyOn(backend, 'getAntigravityInfo').mockResolvedValue({
      connected: false,
      status: 'preview',
      error: 'Quota tracking arrives when Google ships a stable usage API.',
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(AntigravityPanel, { autoRefreshIntervalMs: 0 }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Quota tracking is in preview');
    expect(text).toContain('stable usage API');
    expect(text).not.toContain('Unavailable');
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it('labels retained Codex limits as stale when the refresh carries an error', async () => {
    vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true, planType: 'pro' });
    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({
      connected: true,
      planType: 'pro',
      primary: { usedPercent: 64, windowMinutes: 300 },
      error: 'Rate limit refresh failed',
    });
    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({
      connected: true,
      availableCount: 0,
      credits: [],
    });
    vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Rate limit refresh failed');
    expect(renderer.root.findAllByProps({ className: 'error-banner' })).toHaveLength(1);
    expect(text).toContain('当前显示上次成功读取的数据');
    expect(renderer.root.findByProps({ 'aria-label': '5-hour window usage' }).props['aria-valuenow']).toBe(64);
    await act(async () => renderer.unmount());
  });

  it('does not claim last-known Codex quota when an error response has no limits', async () => {
    vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true, planType: 'pro' });
    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({
      connected: false,
      error: 'Codex rate limit request failed: 401',
    });
    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({
      connected: true,
      availableCount: 0,
      credits: [],
    });
    vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Codex rate limit request failed: 401');
    expect(text).not.toContain('Stale data');
    expect(text).not.toContain('当前显示上次成功读取的数据');
    await act(async () => renderer.unmount());
  });

  it('keeps fresh Codex limits connected when only account metadata fails', async () => {
    vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({
      connected: false,
      error: 'Codex ID token is unavailable',
    });
    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({
      connected: true,
      planType: 'pro',
      primary: { usedPercent: 64, windowMinutes: 300 },
    });
    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({
      connected: true,
      availableCount: 0,
      credits: [],
    });
    vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Codex ID token is unavailable');
    expect(renderer.root.findAllByProps({ className: 'codex-content' })).toHaveLength(1);
    expect(renderer.root.findByProps({ 'aria-label': '5-hour window usage' }).props['aria-valuenow']).toBe(64);
    expect(text).not.toContain('Stale data');
    expect(text).not.toContain('当前显示上次成功读取的数据');
    await act(async () => renderer.unmount());
  });

  it('clears parent Cursor tray after a later rejected refresh', async () => {
    vi.spyOn(backend, 'getCursorInfo')
      .mockResolvedValueOnce({ connected: true, fastUsed: 231, fastLimit: 500, percentage: 46.2 })
      .mockRejectedValueOnce(new Error('Cursor refresh failed'));
    const onConnectionChange = vi.fn();
    const onUsageChange = vi.fn();
    const onQuotaWindowsChange = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CursorPanel, {
        autoRefreshIntervalMs: 0,
        manualRefreshNonce: 0,
        onConnectionChange,
        onUsageChange,
        onQuotaWindowsChange,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });
    onConnectionChange.mockClear();
    onUsageChange.mockClear();
    onQuotaWindowsChange.mockClear();
    await act(async () => {
      renderer.update(createElement(CursorPanel, {
        autoRefreshIntervalMs: 0,
        manualRefreshNonce: 1,
        onConnectionChange,
        onUsageChange,
        onQuotaWindowsChange,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Cursor refresh failed');
    expect(renderer.root.findAllByProps({ className: 'error-banner' })).toHaveLength(1);
    expect(text).toContain('当前显示上次成功读取的数据');
    expect(text).toContain('231 / 500 · 46%');
    expect(onConnectionChange).toHaveBeenCalledWith(false);
    expect(onUsageChange).toHaveBeenCalledWith(null);
    expect(onQuotaWindowsChange).toHaveBeenCalledWith([]);
    await act(async () => renderer.unmount());
  });

  it('clears parent Codex tray after a later rejected refresh', async () => {
    vi.spyOn(backend, 'getCodexInfo')
      .mockResolvedValueOnce({ connected: true, planType: 'pro' })
      .mockRejectedValueOnce(new Error('Codex refresh failed'));
    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({
      connected: true,
      planType: 'pro',
      primary: { usedPercent: 64, windowMinutes: 300 },
    });
    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({
      connected: true,
      availableCount: 0,
      credits: [],
    });
    vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
    const onConnectionChange = vi.fn();
    const onUsageChange = vi.fn();
    const onQuotaWindowsChange = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        manualRefreshNonce: 0,
        onConnectionChange,
        onUsageChange,
        onQuotaWindowsChange,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });
    onConnectionChange.mockClear();
    onUsageChange.mockClear();
    onQuotaWindowsChange.mockClear();
    await act(async () => {
      renderer.update(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        manualRefreshNonce: 1,
        onConnectionChange,
        onUsageChange,
        onQuotaWindowsChange,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Codex refresh failed');
    expect(text).toContain('当前显示上次成功读取的数据');
    expect(renderer.root.findByProps({ 'aria-label': '5-hour window usage' }).props['aria-valuenow']).toBe(64);
    expect(onConnectionChange).toHaveBeenCalledWith(false);
    expect(onUsageChange).toHaveBeenCalledWith(null);
    expect(onQuotaWindowsChange).toHaveBeenCalledWith([]);
    await act(async () => renderer.unmount());
  });

  it('labels connected Cursor fallback responses as stale', async () => {
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({
      connected: true,
      fastUsed: 231,
      fastLimit: 500,
      percentage: 46.2,
      error: 'Cursor network refresh failed',
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CursorPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Cursor network refresh failed');
    expect(renderer.root.findAllByProps({ className: 'error-banner' })).toHaveLength(1);
    expect(text).toContain('当前显示上次成功读取的数据');
    await act(async () => renderer.unmount());
  });

  it('labels connected Grok last-good fallback as stale', async () => {
    vi.spyOn(backend, 'getGrokInfo').mockResolvedValue({
      connected: true,
      percentage: 4,
      products: [],
      error: 'Too many open files (os error 24)',
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(GrokPanel, {
        autoRefreshIntervalMs: 0,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Too many open files');
    expect(renderer.root.findAllByProps({ className: 'error-banner' })).toHaveLength(1);
    expect(text).toContain('当前显示上次成功读取的数据');
    expect(text).toContain('4%');
    await act(async () => renderer.unmount());
  });

  it('shows Cursor request counts with the percentage and separates account metadata', async () => {
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({
      connected: true,
      fastUsed: 615,
      fastLimit: 500,
      percentage: 123,
      email: 'developer@example.com',
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CursorPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    expect(renderedText(renderer)).toContain('615 / 500 · 123%');
    expect(renderer.root.findAllByProps({ className: 'provider-detail-header' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'account-strip' })).toHaveLength(1);
    const progress = renderer.root.findByProps({ role: 'progressbar' });
    expect(progress.props['aria-valuenow']).toBe(100);
    expect(progress.props['aria-valuetext']).toBe('123% 已用');
    await act(async () => renderer.unmount());
  });

  it('shows Cursor Models and Other Models bars from the dashboard usage-summary', async () => {
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({
      connected: true,
      planType: 'ultra',
      autoPercent: 2.888,
      apiPercent: 91.082,
      percentage: 91.082,
      onDemandEnabled: false,
      onDemandUsedCents: 1250.5,
      resetAt: '2026-09-16T15:37:22.000Z',
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CursorPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Cursor Models');
    expect(text).toContain('3% 已用');
    expect(text).toContain('Other Models');
    expect(text).toContain('91% 已用');
    expect(text).toContain('Includes Cursor Grok and Composer');
    expect(text).not.toContain('on-demand spend');
    expect(text).toContain('On-demand');
    expect(text).toContain('$12.51');
    expect(text).not.toContain('Included requests');
    await act(async () => renderer.unmount());
  });

  it('reports Cursor Models usage to the tray instead of Other Models', async () => {
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({
      connected: true,
      autoPercent: 17,
      apiPercent: 100,
      percentage: 100,
    });
    const onUsageChange = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CursorPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
        onUsageChange,
      }));
      await Promise.resolve();
    });

    expect(onUsageChange).toHaveBeenCalledWith(17);
    await act(async () => renderer.unmount());
  });

  it('formats enabled Cursor on-demand usage as US dollars', async () => {
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({
      connected: true,
      planType: 'pro',
      autoPercent: 20,
      apiPercent: 30,
      percentage: 30,
      onDemandEnabled: true,
      onDemandUsedCents: 1250.5,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CursorPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Additional usage beyond limits consumes on-demand spend.');
    expect(text).toContain('On-demand');
    expect(text).toContain('$12.51');
    await act(async () => renderer.unmount());
  });

  it('renders percentage-only Cursor usage fallback', async () => {
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({
      connected: true,
      planType: 'pro',
      percentage: 25.4,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(CursorPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
      }));
      await Promise.resolve();
    });

    const text = renderedText(renderer);
    expect(text).toContain('额度用量');
    expect(text).toContain('25% 已用');
    const progress = renderer.root.findByProps({ role: 'progressbar' });
    expect(progress.props['aria-label']).toBe('Cursor usage');
    await act(async () => renderer.unmount());
  });

  it('shows n/a when Codex credits exist without a balance', async () => {
    async function renderCredits(credits: { hasCredits: boolean; unlimited: boolean; balance?: string }) {
      vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true, planType: 'plus' });
      vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({
        connected: true,
        planType: 'plus',
        primary: { usedPercent: 10, windowMinutes: 300 },
        credits,
      });
      vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({
        connected: true,
        availableCount: 0,
        credits: [],
      });
      vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(createElement(CodexPanel, {
          autoRefreshIntervalMs: 0,
          showCostSummary: false,
          sections: hiddenSections,
        }));
        await Promise.resolve();
      });
      return renderer;
    }

    function creditValue(renderer: ReactTestRenderer): string {
      const label = renderer.root.findAllByProps({ className: 'quota-label' })
        .find((node) => node.children.includes('Credits'));
      expect(label).toBeDefined();
      return label!.parent!.findByProps({ className: 'quota-value' }).children.join('');
    }

    const missing = await renderCredits({ hasCredits: true, unlimited: false });
    expect(creditValue(missing)).toBe('n/a');
    await act(async () => missing.unmount());

    const zero = await renderCredits({ hasCredits: true, unlimited: false, balance: '0' });
    expect(creditValue(zero)).toBe('0');
    await act(async () => zero.unmount());
  });
});


it('withholds current usage advice when a high-usage snapshot is stale', async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(ClaudePanel, {
      quota: { connected: true, weeklyTotal: { used: 95, limit: 100, percentage: 95 } },
      loading: false, error: 'Network unavailable', windowVisible: true,
      costRefreshKey: 0, onRetry: vi.fn(), sections: { ...hiddenSections, tips: true },
    }));
  });
  expect(renderedText(renderer)).toContain('95% 已用');
  expect(renderedText(renderer)).toContain('当前显示上次成功读取的数据。');
  expect(renderer.root.findAllByProps({ className: 'smart-tip' })).toHaveLength(0);
  await act(async () => renderer.unmount());
});

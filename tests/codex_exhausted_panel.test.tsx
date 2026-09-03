import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CodexPanel from '../src/components/CodexPanel';
import { backend } from '../src/services/backend';

function rendered_text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount());
}

const WEEKLY_RESET = 1_787_961_600;

async function render_exhausted(options?: {
  usedPercent?: number;
  bonusCount?: number;
  valueObservedAt?: string;
  valueResetsAt?: string;
  onOpenDashboard?: () => void;
}): Promise<ReactTestRenderer> {
  const usedPercent = options?.usedPercent ?? 100;
  const bonusCount = options?.bonusCount ?? 1;
  const observedAt = options?.valueObservedAt ?? new Date(Date.now() - 31 * 60 * 1000).toISOString();
  vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true, planType: 'plus' });
  vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue({
    connected: true,
    planType: 'plus',
    primary: {
      usedPercent,
      windowMinutes: 10_080,
      resetsAt: WEEKLY_RESET,
    },
  });
  vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue({
    connected: true,
    availableCount: bonusCount,
    credits: Array.from({ length: bonusCount }, () => ({
      status: 'available',
      title: 'Gifted',
      grantedAt: '2026-09-06T00:00:00Z',
      expiresAt: '2026-10-06T00:00:00Z',
    })),
  });
  vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({
    quota: {
      observedAt,
      resetsAt: '2026-08-29T00:00:00Z',
      windowMinutes: 10_080,
      usedPct: usedPercent,
      remainingPct: Math.max(0, 100 - usedPercent),
      projectedPctAtReset: usedPercent,
      status: usedPercent >= 100 ? 'exhausted' : 'on_track',
    },
    valueEstimate: {
      observedAt,
      windowStartedAt: '2026-08-22T00:00:00Z',
      resetsAt: options?.valueResetsAt ?? '2026-08-29T00:00:00Z',
      usedPct: usedPercent,
      observedCostUsd: 186,
      estimatedWeeklyValueUsd: 186,
      observedTokens: 4_200_000,
      estimatedWeeklyTokens: 4_200_000,
    },
  });

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(CodexPanel, {
      autoRefreshIntervalMs: 0,
      showCostSummary: false,
      onOpenDashboard: options?.onOpenDashboard,
    }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe('Codex exhausted panel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps official 100%, last estimate, and a clickable bonus card', async () => {
    const onOpenDashboard = vi.fn();
    const renderer = await render_exhausted({ onOpenDashboard });
    const text = rendered_text(renderer);

    expect(text).toContain('100%');
    expect(text).toContain('Weekly exhausted');
    expect(text).toContain('API-equivalent week');
    expect(text).toContain('Last estimate');
    expect(text).toContain('$186.00');
    expect(text).not.toContain('Weekly value unavailable');
    expect(text).not.toContain('Local pace unavailable');
    expect(text).toContain('Local extras paused');
    expect(text).toContain('Weekly is used up.');
    expect(text).toContain('or use 1 bonus reset');
    expect(text).not.toContain('Codex Weekly is at 100%.');
    expect(text).toContain('Opens ChatGPT. QuotaBar cannot apply this reset.');
    expect(text).toContain('Updated just now');
    expect(text).toContain('Quota current');

    const button = renderer.root.findByProps({ className: 'bonus-panel bonus-panel-action' });
    await act(async () => {
      button.props.onClick();
    });
    expect(onOpenDashboard).toHaveBeenCalledTimes(1);
    await unmount(renderer);
  });

  it('hides the bonus card and uses the wait tip when no credit is available', async () => {
    const renderer = await render_exhausted({ bonusCount: 0 });
    const text = rendered_text(renderer);

    expect(text).toContain('Weekly is used up. Resets');
    expect(text).not.toContain('bonus reset');
    expect(text).not.toContain('Bonus resets');
    await unmount(renderer);
  });

  it('hides a prior-week estimate when the official reset no longer matches', async () => {
    const renderer = await render_exhausted({
      valueResetsAt: '2026-09-05T00:00:00Z',
    });
    const text = rendered_text(renderer);

    expect(text).toContain('100%');
    expect(text).not.toContain('API-equivalent week');
    expect(text).not.toContain('$186.00');
    await unmount(renderer);
  });

  it('keeps the fresh estimate card when the week is not exhausted', async () => {
    const renderer = await render_exhausted({
      usedPercent: 40,
      bonusCount: 0,
      valueObservedAt: new Date().toISOString(),
    });
    const text = rendered_text(renderer);

    expect(text).toContain('Connected');
    expect(text).not.toContain('Weekly exhausted');
    expect(text).toContain('Local estimate');
    expect(text).not.toContain('Last estimate');
    expect(text).not.toContain('Weekly is used up.');
    await unmount(renderer);
  });
});

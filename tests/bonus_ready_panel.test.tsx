import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import CodexPanel from '../src/components/CodexPanel';
import { backend } from '../src/services/backend';
import type { CodexRateLimits, CodexResetCredits } from '../src/types/models';

const hiddenSections = { timeline: false, cost: false, trend: false, tips: false };

const exhaustedLimits = {
  connected: true,
  planType: 'plus',
  secondary: {
    usedPercent: 100,
    windowMinutes: 10_080,
    resetsAt: 1_787_961_600,
  },
};

const emptyLimits: CodexRateLimits = {
  connected: false,
  error: 'Network error',
};

const leftoverCredits: CodexResetCredits = {
  connected: true,
  availableCount: 1,
  credits: [{ status: 'available', expiresAt: '2026-09-10T00:00:00Z' }],
};

const disconnectedCredits: CodexResetCredits = {
  connected: false,
  availableCount: 0,
  credits: [],
  error: 'Network error',
};

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

async function render_panel(
  credits: CodexResetCredits,
  onBonusReadyChange: (ready: { exhausted: boolean; availableCount: number }) => void,
  manualRefreshNonce = 0,
  limits: CodexRateLimits = exhaustedLimits,
): Promise<ReactTestRenderer> {
  vi.spyOn(backend, 'getCodexInfo').mockResolvedValue({ connected: true, planType: 'plus' });
  vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue(limits);
  vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue(credits);
  vi.spyOn(backend, 'getCodexWeeklyQuota').mockResolvedValue({});
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(CodexPanel, {
      autoRefreshIntervalMs: 0,
      showCostSummary: false,
      sections: hiddenSections,
      manualRefreshNonce,
      onBonusReadyChange,
    }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe('Codex bonusReady reporting', () => {
  it('does not report a snapshot while reset credits are disconnected', async () => {
    const onBonusReadyChange = vi.fn();
    const renderer = await render_panel(disconnectedCredits, onBonusReadyChange);
    expect(onBonusReadyChange).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('reports the first connected leftover snapshot after fail-soft credits', async () => {
    const onBonusReadyChange = vi.fn();
    const renderer = await render_panel(disconnectedCredits, onBonusReadyChange);
    expect(onBonusReadyChange).not.toHaveBeenCalled();

    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue(leftoverCredits);
    await act(async () => {
      renderer.update(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
        manualRefreshNonce: 1,
        onBonusReadyChange,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onBonusReadyChange).toHaveBeenCalledTimes(1);
    expect(onBonusReadyChange).toHaveBeenCalledWith({
      exhausted: true,
      availableCount: 1,
    });
    await act(async () => renderer.unmount());
  });

  it('does not overwrite a connected leftover snapshot when credits later fail-soft', async () => {
    const onBonusReadyChange = vi.fn();
    const renderer = await render_panel(leftoverCredits, onBonusReadyChange);
    expect(onBonusReadyChange).toHaveBeenCalledTimes(1);
    expect(onBonusReadyChange).toHaveBeenCalledWith({
      exhausted: true,
      availableCount: 1,
    });

    vi.spyOn(backend, 'getCodexResetCredits').mockResolvedValue(disconnectedCredits);
    await act(async () => {
      renderer.update(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
        manualRefreshNonce: 1,
        onBonusReadyChange,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onBonusReadyChange).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it('does not report while the official weekly window is missing', async () => {
    const onBonusReadyChange = vi.fn();
    const renderer = await render_panel(leftoverCredits, onBonusReadyChange, 0, emptyLimits);
    expect(onBonusReadyChange).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('reports the first leftover snapshot after official weekly usage appears', async () => {
    const onBonusReadyChange = vi.fn();
    const renderer = await render_panel(leftoverCredits, onBonusReadyChange, 0, emptyLimits);
    expect(onBonusReadyChange).not.toHaveBeenCalled();

    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue(exhaustedLimits);
    await act(async () => {
      renderer.update(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
        manualRefreshNonce: 1,
        onBonusReadyChange,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onBonusReadyChange).toHaveBeenCalledTimes(1);
    expect(onBonusReadyChange).toHaveBeenCalledWith({
      exhausted: true,
      availableCount: 1,
    });
    await act(async () => renderer.unmount());
  });

  it('does not overwrite a leftover snapshot when official weekly usage later disappears', async () => {
    const onBonusReadyChange = vi.fn();
    const renderer = await render_panel(leftoverCredits, onBonusReadyChange);
    expect(onBonusReadyChange).toHaveBeenCalledTimes(1);

    vi.spyOn(backend, 'getCodexRateLimits').mockResolvedValue(emptyLimits);
    await act(async () => {
      renderer.update(createElement(CodexPanel, {
        autoRefreshIntervalMs: 0,
        showCostSummary: false,
        sections: hiddenSections,
        manualRefreshNonce: 1,
        onBonusReadyChange,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onBonusReadyChange).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });
});

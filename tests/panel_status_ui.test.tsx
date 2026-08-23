import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AntigravityPanel from '../src/components/AntigravityPanel';
import ClaudePanel from '../src/components/ClaudePanel';
import CursorPanel from '../src/components/CursorPanel';
import OverviewPanel from '../src/components/OverviewPanel';
import ProviderDetailHeader from '../src/components/ProviderDetailHeader';
import { backend } from '../src/services/backend';

const hiddenSections = { timeline: false, cost: false, trend: false, tips: false };

function renderedText(renderer: ReactTestRenderer): string {
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
  it('keeps connection, plan, and usage visible in the provider header', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(ProviderDetailHeader, {
        service: 'cursor',
        status: 'Connected',
        plan: 'Cursor Pro',
        usedPercent: 47,
      }));
    });

    const text = renderedText(renderer);
    expect(text).toContain('Cursor');
    expect(text).toContain('Connected');
    expect(text).toContain('Cursor Pro');
    expect(text).toContain('47% used');
  });

  it('labels the overview independently and exposes the connected count', async () => {
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
    expect(text).toContain('Overview');
    expect(text).toContain('1 of 2 connected');
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
    expect(text).toContain('Showing last known data');
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
    expect(text).toContain('CLI detected');
    expect(text).toContain('Antigravity is connected');
    expect(text).not.toContain('Antigravity is not connected');
    expect(text).not.toContain('⧉');
    await act(async () => renderer.unmount());
  });

  it('shows Cursor request counts with the percentage and separates account metadata', async () => {
    vi.spyOn(backend, 'getCursorInfo').mockResolvedValue({
      connected: true,
      fastUsed: 231,
      fastLimit: 500,
      percentage: 46.2,
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

    expect(renderedText(renderer)).toContain('231 / 500 · 46%');
    expect(renderer.root.findAllByProps({ className: 'account-strip' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ role: 'progressbar' })).toHaveLength(1);
    await act(async () => renderer.unmount());
  });
});

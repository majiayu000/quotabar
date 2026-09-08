import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import ProviderSetup from '../src/components/ProviderSetup';
import OverviewPanel from '../src/components/OverviewPanel';
import { buildProviderSummaries } from '../src/services/provider_summary';
import { defaultServiceMap, getSavedTab } from '../src/services/app_state';

describe('first connection', () => {
  it('starts new installs on Overview', () => {
    expect(getSavedTab()).toBe('all');
  });

  it('explains provider login and leaves unsupported quota tracking explicit', () => {
    const html = renderToStaticMarkup(<OverviewPanel
      summaries={buildProviderSummaries(defaultServiceMap(false), defaultServiceMap(false), defaultServiceMap(null))}
      mostConstrained={[]} upcomingResets={[]} costRefreshKey={0} showCostSummary={false}
      onProviderSelect={() => {}} onRetry={() => {}}
    />);
    expect(html).toContain('Connect your first service');
    expect(html).toContain('claude login');
    expect(html).toContain('codex login');
    expect(html).toContain('grok login');
    expect(html).toContain('Open Cursor');
    expect(html).toContain('Coming later');
    expect(html).toContain('does not manage your login');
  });

  it('checks again after login and disables the check while loading', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const retry = vi.fn();
    let renderer!: ReturnType<typeof create>;
    try {
      await act(async () => { renderer = create(<ProviderSetup service="claude" onRetry={retry} />); });
      await act(async () => renderer.root.findByType('button').props.onClick());
      expect(retry).toHaveBeenCalledOnce();
      await act(async () => renderer.update(<ProviderSetup service="claude" onRetry={retry} loading />));
      expect(renderer.root.findByType('button').props.disabled).toBe(true);
    } finally {
      if (renderer) await act(async () => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });
});

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFooterStatus } from '../src/hooks/use_footer_status';

type FooterStatus = ReturnType<typeof useFooterStatus>;

let latestStatus: FooterStatus | undefined;

function FooterStatusHarness({
  visible,
  loading,
  lastUpdatedAt,
}: {
  visible: boolean;
  loading: boolean;
  lastUpdatedAt: number | null;
}) {
  latestStatus = useFooterStatus(visible, loading, lastUpdatedAt);
  return null;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
  latestStatus = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

describe('useFooterStatus', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount());
    renderer = undefined;
  });

  it('reports loading and not-yet-updated states', async () => {
    await act(async () => {
      renderer = create(
        <FooterStatusHarness visible loading lastUpdatedAt={null} />,
      );
    });
    expect(latestStatus).toEqual({
      footerStatus: 'Updating...',
      footerStatusTitle: 'Not updated yet',
    });
  });

  it('refreshes relative time while the popover is visible', async () => {
    const lastUpdatedAt = Date.now() - 30_000;
    await act(async () => {
      renderer = create(
        <FooterStatusHarness visible loading={false} lastUpdatedAt={lastUpdatedAt} />,
      );
    });
    expect(latestStatus?.footerStatus).toBe('Updated now');

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(latestStatus?.footerStatus).toBe('Updated 1m ago');
  });

  it('runs and cleans up the timer only while visible', async () => {
    await act(async () => {
      renderer = create(
        <FooterStatusHarness visible={false} loading={false} lastUpdatedAt={Date.now()} />,
      );
    });
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      renderer?.update(
        <FooterStatusHarness visible loading={false} lastUpdatedAt={Date.now()} />,
      );
    });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      renderer?.update(
        <FooterStatusHarness visible={false} loading={false} lastUpdatedAt={Date.now()} />,
      );
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

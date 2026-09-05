import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useServiceEvents } from '../src/hooks/use_service_events';
import { defaultServiceMap } from '../src/services/app_state';
import * as notifications from '../src/services/notifications';
import type { NotificationSettings } from '../src/services/notifications';
import type { ServiceMap } from '../src/services/app_state';

vi.mock('../src/services/notifications', async () => {
  const actual = await vi.importActual<typeof import('../src/services/notifications')>(
    '../src/services/notifications',
  );
  return {
    ...actual,
    notify: vi.fn(async () => ({ status: 'sent' as const })),
  };
});

const ALL_ON: NotificationSettings = {
  q80: true,
  q95: true,
  q100: true,
  bonusReady: true,
  bonus: true,
};

function Host({
  used,
  settings = ALL_ON,
  enabled = true,
  logEvent,
}: {
  used: ServiceMap<number | null>;
  settings?: NotificationSettings;
  enabled?: boolean;
  logEvent: (level: 'info' | 'warning' | 'critical', text: string) => void;
}) {
  useServiceEvents(null, defaultServiceMap(true), used, settings, logEvent, enabled);
  return null;
}

describe('useServiceEvents 100% crossings', () => {
  it('does not duplicate background events or notifications in the workspace', async () => {
    const logEvent = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Host, { used: defaultServiceMap<number | null>(70), logEvent, enabled: false }));
    });
    await act(async () => {
      renderer.update(createElement(Host, { used: defaultServiceMap<number | null>(100), logEvent, enabled: false }));
    });
    expect(logEvent).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  afterEach(() => {
    vi.mocked(notifications.notify).mockClear();
  });

  it('logs and notifies when usage reaches 100%, independently of 95%', async () => {
    const logEvent = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Host, {
        used: defaultServiceMap<number | null>(94),
        logEvent,
      }));
    });
    await act(async () => {
      renderer.update(createElement(Host, {
        used: { ...defaultServiceMap<number | null>(94), codex: 100 },
        logEvent,
      }));
    });

    expect(logEvent).toHaveBeenCalledWith('critical', 'Codex usage crossed 95%');
    expect(logEvent).toHaveBeenCalledWith('critical', 'Codex usage reached 100%');
    expect(vi.mocked(notifications.notify).mock.calls.map((call) => call[1])).toEqual([
      'Codex usage crossed 95%',
      'Codex usage reached 100%',
    ]);
    const hundredOptions = vi.mocked(notifications.notify).mock.calls[1]?.[2];
    expect(typeof hundredOptions?.on_failure).toBe('function');
    await act(async () => renderer.unmount());
  });

  it('does not notify 100% when the toggle is off, but still logs', async () => {
    const logEvent = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Host, {
        used: defaultServiceMap<number | null>(99),
        settings: { ...ALL_ON, q100: false },
        logEvent,
      }));
    });
    await act(async () => {
      renderer.update(createElement(Host, {
        used: { ...defaultServiceMap<number | null>(99), cursor: 100 },
        settings: { ...ALL_ON, q100: false },
        logEvent,
      }));
    });

    expect(logEvent).toHaveBeenCalledWith('critical', 'Cursor usage reached 100%');
    expect(vi.mocked(notifications.notify)).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('does not emit bonusReady from the used-percent hook', async () => {
    const logEvent = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Host, {
        used: defaultServiceMap<number | null>(90),
        logEvent,
      }));
    });
    await act(async () => {
      renderer.update(createElement(Host, {
        used: defaultServiceMap<number | null>(100),
        logEvent,
      }));
    });

    expect(logEvent.mock.calls.some((call) => String(call[1]).includes('bonus reset'))).toBe(false);
    await act(async () => renderer.unmount());
  });
});

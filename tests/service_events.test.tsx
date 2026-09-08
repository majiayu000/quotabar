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
  cursorWindows = [],
  logEvent,
}: {
  used: ServiceMap<number | null>;
  settings?: NotificationSettings;
  enabled?: boolean;
  cursorWindows?: Array<{ provider: 'cursor'; providerLabel: string; label: string; usedPercent: number }>;
  logEvent: (level: 'info' | 'warning' | 'critical', text: string) => void;
}) {
  useServiceEvents(null, defaultServiceMap(true), used, settings, logEvent, enabled, cursorWindows);
  return null;
}

function cursorDashboardWindows(autoPercent: number, apiPercent: number) {
  return [
    { provider: 'cursor' as const, providerLabel: 'Cursor', label: 'Cursor Models', usedPercent: autoPercent },
    { provider: 'cursor' as const, providerLabel: 'Cursor', label: 'Other Models', usedPercent: apiPercent },
  ];
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

describe('useServiceEvents Cursor hottest-window alerts', () => {
  afterEach(() => {
    vi.mocked(notifications.notify).mockClear();
  });

  it('fires 80/95 from Other Models even when the tray stays on Cursor Models', async () => {
    const logEvent = vi.fn();
    const trayUsed = { ...defaultServiceMap<number | null>(null), cursor: 2.888 };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Host, {
        used: trayUsed,
        cursorWindows: cursorDashboardWindows(2.888, 70),
        logEvent,
      }));
    });
    await act(async () => {
      renderer.update(createElement(Host, {
        used: trayUsed,
        cursorWindows: cursorDashboardWindows(2.888, 96),
        logEvent,
      }));
    });

    expect(logEvent).toHaveBeenCalledWith('critical', 'Cursor usage crossed 95%');
    expect(logEvent).not.toHaveBeenCalledWith('warning', 'Cursor usage crossed 80%');
    expect(vi.mocked(notifications.notify).mock.calls.map((call) => call[1])).toEqual([
      'Cursor usage crossed 95%',
    ]);
    await act(async () => renderer.unmount());
  });

  it('fires 80 from Other Models while the tray Models percent stays low', async () => {
    const logEvent = vi.fn();
    const trayUsed = { ...defaultServiceMap<number | null>(null), cursor: 3 };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Host, {
        used: trayUsed,
        cursorWindows: cursorDashboardWindows(3, 70),
        logEvent,
      }));
    });
    await act(async () => {
      renderer.update(createElement(Host, {
        used: trayUsed,
        cursorWindows: cursorDashboardWindows(3, 81),
        logEvent,
      }));
    });

    expect(logEvent).toHaveBeenCalledWith('warning', 'Cursor usage crossed 80%');
    expect(logEvent).not.toHaveBeenCalledWith('critical', 'Cursor usage crossed 95%');
    expect(vi.mocked(notifications.notify).mock.calls.map((call) => call[1])).toEqual([
      'Cursor usage crossed 80%',
    ]);
    await act(async () => renderer.unmount());
  });

  it('does not fire Cursor 80/95 from the Models tray percent when Other Models is already the hottest window', async () => {
    const logEvent = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Host, {
        used: { ...defaultServiceMap<number | null>(null), cursor: 3 },
        cursorWindows: cursorDashboardWindows(3, 90),
        logEvent,
      }));
    });
    await act(async () => {
      renderer.update(createElement(Host, {
        used: { ...defaultServiceMap<number | null>(null), cursor: 81 },
        cursorWindows: cursorDashboardWindows(81, 90),
        logEvent,
      }));
    });

    expect(logEvent).not.toHaveBeenCalledWith('warning', 'Cursor usage crossed 80%');
    expect(logEvent).not.toHaveBeenCalledWith('critical', 'Cursor usage crossed 95%');
    expect(notifications.notify).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });
});

import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionSpeedDetail } from '../src/components/OverviewPanel';
import type { AnalysisSession } from '../src/services/backend';

const speed: AnalysisSession['output_speed'] = { status: 'measured', median_tokens_per_second: 42.25, measured_responses: 3, excluded_responses: 1, models: [] };
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
type Rect = ReturnType<typeof rect>;

// A tooltip node as a webview without the Popover API sees it: no showPopover(), and a fixed box that is laid out
// from the dialog's corner when a transformed dialog contains it.
function plainTooltip(dialog: Rect | null = null) {
  const style: Record<string, string> = {};
  return {
    hidden: true,
    style,
    closest: (selector: string) => selector === 'dialog' && dialog ? { getBoundingClientRect: () => dialog } : null,
    getBoundingClientRect: () => rect((dialog?.left ?? 0) + parseFloat(style.left ?? '0'), (dialog?.top ?? 0) + parseFloat(style.top ?? '0'), 300, 120),
  };
}

async function renderHint(tooltip: Record<string, unknown>, anchor: Rect) {
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal('document', { activeElement: null });
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(SessionSpeedDetail, { speed }), {
      createNodeMock: (element: ReactElement<{ role?: string }>) => element.props.role === 'tooltip' ? tooltip : { getBoundingClientRect: () => anchor },
    });
  });
  return {
    renderer,
    hint: renderer.root.findByProps({ className: 'output-speed-hint' }),
    trigger: renderer.root.findByProps({ className: 'output-speed-hint-trigger' }),
    tooltipProps: renderer.root.findByProps({ role: 'tooltip' }).props,
  };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

describe('output speed hint', () => {
  // WKWebView on macOS 13 and older predates the Popover API; tauri.conf.json still allows macOS 10.15.
  it('toggles the hidden attribute in a webview without the Popover API', async () => {
    const tooltip = plainTooltip();
    const { renderer, hint, trigger, tooltipProps } = await renderHint(tooltip, rect(600, 100, 16, 16));

    // An uncaught TypeError here reaches the window error listener and replaces the workspace with the fatal surface.
    for (const open of [hint.props.onMouseEnter, trigger.props.onFocus, trigger.props.onClick]) {
      tooltip.hidden = true;
      expect(() => open()).not.toThrow();
      expect(tooltip.hidden).toBe(false);
    }
    // Without the UA popover styles the tooltip must not be painted until it is asked for.
    expect(tooltipProps.hidden).toBe(true);
    expect(tooltip.style).toEqual({ left: '316px', top: '122px' });
    expect(() => hint.props.onMouseLeave()).not.toThrow();
    expect(tooltip.hidden).toBe(true);
    tooltip.hidden = false;
    expect(() => trigger.props.onBlur()).not.toThrow();
    expect(tooltip.hidden).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('keeps the fallback tooltip inside the session dialog that contains and clips it', async () => {
    const dialog = rect(371, 33, 538, 734);
    const tooltip = plainTooltip(dialog);
    const { renderer, hint } = await renderHint(tooltip, rect(542, 593, 18, 18));

    hint.props.onMouseEnter();
    // Right-aligning to the trigger would start at x=260, left of the dialog edge; it sits just below the trigger instead.
    expect(tooltip.getBoundingClientRect()).toMatchObject({ left: 379, top: 617, right: 679, bottom: 737 });
    await act(async () => renderer.unmount());
  });

  it('keeps using the Popover API where the webview has it', async () => {
    vi.stubGlobal('HTMLElement', class { showPopover() {} });
    const tooltip = { hidden: false, style: {}, getBoundingClientRect: () => rect(0, 0, 300, 120), showPopover: vi.fn(), hidePopover: vi.fn() };
    const { renderer, hint, trigger, tooltipProps } = await renderHint(tooltip, rect(600, 100, 16, 16));
    expect(tooltipProps.popover).toBe('auto');
    expect(tooltipProps.hidden).toBeFalsy();

    hint.props.onMouseEnter();
    expect(tooltip.showPopover).toHaveBeenCalledOnce();
    expect(tooltip.style).toEqual({ left: '316px', top: '122px' });
    trigger.props.onBlur();
    expect(tooltip.hidePopover).toHaveBeenCalledOnce();
    expect(tooltip.hidden).toBe(false);
    await act(async () => renderer.unmount());
  });
});

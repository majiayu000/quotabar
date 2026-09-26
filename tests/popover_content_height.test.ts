import { describe, expect, it } from 'vitest';
import { measurePopoverHeight } from '../src/hooks/use_popover_window';

function container(height: number, panels: { scrollHeight: number; clientHeight: number }[]): HTMLElement {
  return { scrollHeight: height, querySelectorAll: () => panels } as unknown as HTMLElement;
}

describe('content-driven popover height', () => {
  it('grows past the current viewport when its scroll panel has hidden content', () => {
    expect(measurePopoverHeight(container(198, [{ scrollHeight: 410, clientHeight: 100 }]))).toBe(510);
  });

  it('requests the same frame after that content becomes fully visible', () => {
    expect(measurePopoverHeight(container(508, [{ scrollHeight: 410, clientHeight: 410 }]))).toBe(510);
  });

  it('caps long settings and keeps the minimum height for short pages', () => {
    expect(measurePopoverHeight(container(398, [{ scrollHeight: 1300, clientHeight: 398 }]))).toBe(582);
    expect(measurePopoverHeight(container(150, []))).toBe(300);
  });

  it('does not subtract unused space or count overflow twice', () => {
    expect(measurePopoverHeight(container(420, [{ scrollHeight: 250, clientHeight: 300 }]))).toBe(422);
    expect(measurePopoverHeight(container(580, [{ scrollHeight: 900, clientHeight: 480 }]))).toBe(582);
  });
});

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLatestRequestGeneration,
  type LatestRequestGeneration,
  useLatestRequestGeneration,
} from '../src/hooks/use_latest_request_generation';

function GenerationProbe({ onGeneration }: { onGeneration(generation: LatestRequestGeneration): void }) {
  onGeneration(useLatestRequestGeneration());
  return null;
}

describe('latest request generation', () => {
  beforeAll(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  });

  it('replaces the current token monotonically and invalidates explicitly', () => {
    const request_generation = createLatestRequestGeneration();

    const first = request_generation.begin();
    expect(first).toBe(1);
    expect(request_generation.isCurrent(first)).toBe(true);

    const second = request_generation.begin();
    expect(second).toBe(2);
    expect(request_generation.isCurrent(first)).toBe(false);
    expect(request_generation.isCurrent(second)).toBe(true);

    request_generation.invalidate();
    expect(request_generation.isCurrent(second)).toBe(false);
  });

  it('keeps one coordinator across renders and invalidates it on unmount', async () => {
    const observed: LatestRequestGeneration[] = [];
    const on_generation = (generation: LatestRequestGeneration) => observed.push(generation);
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(GenerationProbe, { onGeneration: on_generation }));
    });
    await act(async () => {
      renderer.update(createElement(GenerationProbe, { onGeneration: on_generation }));
    });

    expect(observed).toHaveLength(2);
    expect(observed[1]).toBe(observed[0]);
    const generation = observed[0].begin();
    expect(observed[0].isCurrent(generation)).toBe(true);

    await act(async () => {
      renderer.unmount();
    });
    expect(observed[0].isCurrent(generation)).toBe(false);
  });
});

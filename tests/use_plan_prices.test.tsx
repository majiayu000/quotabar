import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlanPrices } from '../src/hooks/use_plan_prices';
import { PLAN_PRICES_STORAGE_KEY, savePlanPrices } from '../src/services/plan_prices';
import { subscribeStorageWriteFailures } from '../src/services/storage';

type View = 'settings' | 'overview';
let renderers: ReactTestRenderer[];
let states: Record<View, ReturnType<typeof usePlanPrices>>;
let store: Map<string, string>;
let events: EventTarget;
let setItem: ReturnType<typeof vi.fn>;

function Probe({ view }: { view: View }) {
  states[view] = usePlanPrices();
  return null;
}

async function mount() {
  await act(async () => {
    renderers.push(create(createElement(Probe, { view: 'settings' })));
    renderers.push(create(createElement(Probe, { view: 'overview' })));
  });
}

async function storageEvent(key: string | null) {
  await act(async () => {
    const event = new Event('storage');
    Object.assign(event, { key });
    events.dispatchEvent(event);
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  renderers = [];
  states = {} as typeof states;
  store = new Map();
  events = new EventTarget();
  setItem = vi.fn((key: string, value: string) => store.set(key, value));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem,
  });
  vi.stubGlobal('window', events);
  savePlanPrices({});
  setItem.mockClear();
});

afterEach(async () => {
  await act(async () => renderers.forEach((renderer) => renderer.unmount()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared plan prices', () => {
  it('updates both instances immediately and persists once per edit without a loop', async () => {
    await mount();
    await act(async () => states.settings[1]({ claude: 200, codex: 20 }));
    expect(states.settings[0]).toEqual({ claude: 200, codex: 20 });
    expect(states.overview[0]).toEqual({ claude: 200, codex: 20 });
    expect(setItem).toHaveBeenCalledExactlyOnceWith(
      PLAN_PRICES_STORAGE_KEY, JSON.stringify({ claude: 200, codex: 20 }),
    );

    await act(async () => states.overview[1]({ codex: 30 }));
    expect(states.settings[0]).toEqual({ codex: 30 });
    expect(states.overview[0]).toEqual({ codex: 30 });
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('keeps cross-window storage and clear events read-only and ignores unrelated keys', async () => {
    store.set(PLAN_PRICES_STORAGE_KEY, JSON.stringify({ codex: 20 }));
    await mount();
    expect(states.settings[0]).toEqual({ codex: 20 });
    expect(states.overview[0]).toEqual({ codex: 20 });
    store.set(PLAN_PRICES_STORAGE_KEY, JSON.stringify({ claude: 100 }));
    await storageEvent('other-setting');
    expect(states.overview[0]).toEqual({ codex: 20 });
    await storageEvent(PLAN_PRICES_STORAGE_KEY);
    expect(states.settings[0]).toEqual({ claude: 100 });
    expect(states.overview[0]).toEqual({ claude: 100 });
    store.delete(PLAN_PRICES_STORAGE_KEY);
    await storageEvent(null);
    expect(states.settings[0]).toEqual({});
    expect(states.overview[0]).toEqual({});
    expect(setItem).not.toHaveBeenCalled();
  });

  it('shares the session value and reports one failure when persistence fails', async () => {
    const error = new Error('storage unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFailure = vi.fn();
    const unsubscribe = subscribeStorageWriteFailures(onFailure);
    try {
      await mount();
      consoleError.mockClear();
      setItem.mockImplementation(() => { throw error; });
      await act(async () => states.settings[1]({ claude: 200 }));
      expect(states.settings[0]).toEqual({ claude: 200 });
      expect(states.overview[0]).toEqual({ claude: 200 });
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to persist local setting:', error);
    } finally {
      unsubscribe();
    }
  });
});

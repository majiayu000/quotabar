import { StrictMode, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

const FATAL_MESSAGE = 'Quotabar encountered an unexpected interface error. Restart the app.';
const SURFACE_FAILURE_MESSAGE = 'Failed to display fatal frontend error.';
const SURFACE_ID = 'quotabar-fatal-error';

const entry = vi.hoisted(() => ({
  app: vi.fn(() => null),
  create_root: vi.fn(),
  render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  default: { createRoot: entry.create_root },
}));

vi.mock('../src/App', () => ({ default: entry.app }));

type FailureOperation = 'lookup' | 'create' | 'id' | 'style' | 'text' | 'append';
type CapturedListener = (event: Event) => void;

interface SurfaceState {
  inner_html_write: Mock;
  node: HTMLElement;
  style_text(): string;
  text(): string;
}

interface DocumentDriver {
  append_child: Mock;
  create_element: Mock;
  existing_surface: SurfaceState | null;
  latest_surface(): SurfaceState | null;
  root: HTMLElement;
}

interface EntryDriver {
  add_event_listener: Mock;
  document: DocumentDriver;
  error_spy: ReturnType<typeof vi.spyOn>;
  error_listener: CapturedListener;
  order: string[];
  promise_listener: CapturedListener;
  react_listener: (error: unknown) => void;
}

function create_surface(
  failure: FailureOperation | undefined,
  order: string[],
  initial_id = '',
): SurfaceState {
  let id_value = initial_id;
  let style_value = '';
  let text_value = '';
  const inner_html_write = vi.fn(() => {
    throw new Error('innerHTML must not be used');
  });
  const style = {};
  Object.defineProperty(style, 'cssText', {
    get: () => style_value,
    set: (value: string) => {
      order.push('style');
      if (failure === 'style') throw new Error('style update failed');
      style_value = value;
    },
  });
  const node = { style };
  Object.defineProperties(node, {
    id: {
      get: () => id_value,
      set: (value: string) => {
        order.push('id');
        if (failure === 'id') throw new Error('id update failed');
        id_value = value;
      },
    },
    innerHTML: {
      set: (value: string) => inner_html_write(value),
    },
    textContent: {
      get: () => text_value,
      set: (value: string) => {
        order.push('text');
        if (failure === 'text') throw new Error('text update failed');
        text_value = value;
      },
    },
  });
  return {
    inner_html_write,
    node: node as unknown as HTMLElement,
    style_text: () => style_value,
    text: () => text_value,
  };
}

function create_document(
  order: string[],
  failure?: FailureOperation,
  existing = false,
): DocumentDriver & { stub: Document } {
  const root = { id: 'root' } as unknown as HTMLElement;
  const surfaces = new Map<string, SurfaceState>();
  const node_states = new Map<HTMLElement, SurfaceState>();
  const created: SurfaceState[] = [];
  let existing_surface: SurfaceState | null = null;
  if (existing) {
    existing_surface = create_surface(undefined, order, SURFACE_ID);
    surfaces.set(SURFACE_ID, existing_surface);
    node_states.set(existing_surface.node, existing_surface);
  }
  const get_element_by_id = vi.fn((id: string) => {
    if (id === 'root') return root;
    order.push('lookup');
    if (failure === 'lookup') throw new Error('lookup failed');
    return surfaces.get(id)?.node ?? null;
  });
  const create_element = vi.fn((tag: string) => {
    order.push('create');
    if (failure === 'create') throw new Error('create failed');
    expect(tag).toBe('pre');
    const surface = create_surface(failure, order);
    created.push(surface);
    node_states.set(surface.node, surface);
    return surface.node;
  });
  const append_child = vi.fn((node: HTMLElement) => {
    order.push('append');
    if (failure === 'append') throw new Error('append failed');
    const state = node_states.get(node);
    if (!state) throw new Error('unknown surface');
    surfaces.set(node.id, state);
    return node;
  });
  const stub = {
    body: { appendChild: append_child },
    createElement: create_element,
    getElementById: get_element_by_id,
  } as unknown as Document;
  return {
    append_child,
    create_element,
    existing_surface,
    latest_surface: () => surfaces.get(SURFACE_ID) ?? created.at(-1) ?? null,
    root,
    stub,
  };
}

async function start_entry(options: {
  existing?: boolean;
  failure?: FailureOperation;
} = {}): Promise<EntryDriver> {
  vi.resetModules();
  entry.app.mockClear();
  entry.create_root.mockReset();
  entry.render.mockReset();
  const order: string[] = [];
  const document_driver = create_document(order, options.failure, options.existing);
  const listeners = new Map<string, CapturedListener[]>();
  const add_event_listener = vi.fn((type: string, listener: CapturedListener) => {
    const registered = listeners.get(type) ?? [];
    registered.push(listener);
    listeners.set(type, registered);
  });
  vi.stubGlobal('document', document_driver.stub);
  vi.stubGlobal('window', { addEventListener: add_event_listener });
  entry.create_root.mockReturnValue({ render: entry.render });
  const error_spy = vi.spyOn(console, 'error').mockImplementation((message) => {
    order.push(message === SURFACE_FAILURE_MESSAGE ? 'secondary' : 'primary');
  });
  await import('../src/main');
  const root_options = entry.create_root.mock.calls[0]?.[1] as {
    onUncaughtError?: (error: unknown) => void;
  };
  const error_listener = listeners.get('error')?.[0];
  const promise_listener = listeners.get('unhandledrejection')?.[0];
  if (!error_listener || !promise_listener || !root_options.onUncaughtError) {
    throw new Error('entry callbacks were not registered');
  }
  order.length = 0;
  return {
    add_event_listener,
    document: document_driver,
    error_listener,
    error_spy,
    order,
    promise_listener,
    react_listener: root_options.onUncaughtError,
  };
}

function hostile_event(fields: readonly string[], order: string[]) {
  const prevent_default = vi.fn(() => order.push('prevent'));
  const getters = fields.map((field) => {
    const getter = vi.fn(() => { throw new Error(`${field} getter was evaluated`); });
    return { field, getter };
  });
  const to_string = vi.fn(() => { throw new Error('toString was evaluated'); });
  const event: Record<string, unknown> = {
    preventDefault: prevent_default,
    toString: to_string,
  };
  for (const { field, getter } of getters) {
    Object.defineProperty(event, field, { get: getter });
  }
  return {
    event: event as unknown as Event,
    getters: getters.map(({ getter }) => getter),
    prevent_default,
    to_string,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fatal entry wiring', () => {
  it('registers both global listeners and renders the existing React root once', async () => {
    const driver = await start_entry();
    expect(driver.add_event_listener.mock.calls.map(([type]) => type)).toEqual([
      'error',
      'unhandledrejection',
    ]);
    expect(entry.create_root).toHaveBeenCalledTimes(1);
    expect(entry.create_root.mock.calls[0][0]).toBe(driver.document.root);
    expect(entry.create_root.mock.calls[0][1]).toEqual({
      onUncaughtError: expect.any(Function),
    });
    expect(entry.render).toHaveBeenCalledTimes(1);
    const rendered = entry.render.mock.calls[0][0] as ReactElement;
    expect(rendered.type).toBe(StrictMode);
    expect((rendered.props as { children: ReactElement }).children.type).toBe(entry.app);
  });
});

describe('safe fatal channels and ownership', () => {
  it('cancels global defaults, discards hostile payloads, and reuses one surface', async () => {
    const driver = await start_entry();
    const window_event = hostile_event(['error', 'message'], driver.order);
    const promise_event = hostile_event(['reason'], driver.order);
    const react_payload = {
      secret: 'private-react-marker',
      toString: vi.fn(() => { throw new Error('react toString was evaluated'); }),
    };

    expect(() => driver.error_listener(window_event.event)).not.toThrow();
    expect(driver.order).toEqual(['prevent', 'primary', 'lookup', 'create', 'id', 'style', 'text', 'append']);
    driver.order.length = 0;
    expect(() => driver.promise_listener(promise_event.event)).not.toThrow();
    expect(driver.order).toEqual(['prevent', 'primary', 'lookup', 'text']);
    driver.order.length = 0;
    expect(() => driver.react_listener(react_payload)).not.toThrow();
    expect(driver.order).toEqual(['primary', 'lookup', 'text']);

    expect(window_event.prevent_default).toHaveBeenCalledTimes(1);
    expect(promise_event.prevent_default).toHaveBeenCalledTimes(1);
    for (const getter of [...window_event.getters, ...promise_event.getters]) {
      expect(getter).not.toHaveBeenCalled();
    }
    expect(window_event.to_string).not.toHaveBeenCalled();
    expect(promise_event.to_string).not.toHaveBeenCalled();
    expect(react_payload.toString).not.toHaveBeenCalled();
    expect(driver.error_spy.mock.calls).toEqual([
      [`[fatal:window] ${FATAL_MESSAGE}`],
      [`[fatal:promise] ${FATAL_MESSAGE}`],
      [`[fatal:react] ${FATAL_MESSAGE}`],
    ]);
    expect(driver.document.create_element).toHaveBeenCalledTimes(1);
    expect(driver.document.append_child).toHaveBeenCalledTimes(1);
    const surface = driver.document.latest_surface();
    expect(surface?.text()).toBe(`[react] ${FATAL_MESSAGE}`);
    expect(surface?.style_text()).toContain('position:fixed');
    expect(surface?.inner_html_write).not.toHaveBeenCalled();
  });

  it('updates an existing fatal surface without creating or appending', async () => {
    const driver = await start_entry({ existing: true });
    const event = hostile_event(['error', 'message'], driver.order);
    driver.error_listener(event.event);
    expect(event.prevent_default).toHaveBeenCalledTimes(1);
    expect(driver.document.create_element).not.toHaveBeenCalled();
    expect(driver.document.append_child).not.toHaveBeenCalled();
    expect(driver.document.existing_surface?.text()).toBe(`[window] ${FATAL_MESSAGE}`);
    expect(driver.document.existing_surface?.inner_html_write).not.toHaveBeenCalled();
  });
});

describe.each([
  'lookup',
  'create',
  'id',
  'style',
  'text',
  'append',
] as const)('fatal surface %s failure', (failure) => {
  it('emits fixed primary and secondary diagnostics without raw data or throw', async () => {
    const driver = await start_entry({ failure });
    const event = hostile_event(['error', 'message'], driver.order);
    expect(() => driver.error_listener(event.event)).not.toThrow();
    expect(event.prevent_default).toHaveBeenCalledTimes(1);
    expect(driver.order[0]).toBe('prevent');
    expect(driver.error_spy.mock.calls).toEqual([
      [`[fatal:window] ${FATAL_MESSAGE}`],
      [SURFACE_FAILURE_MESSAGE],
    ]);
    for (const getter of event.getters) expect(getter).not.toHaveBeenCalled();
    expect(event.to_string).not.toHaveBeenCalled();
    const surface = driver.document.latest_surface();
    if (surface) expect(surface.inner_html_write).not.toHaveBeenCalled();
  });
});

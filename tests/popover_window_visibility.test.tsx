import { readFileSync } from 'node:fs';
import { createElement, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { usePopoverWindow } from '../src/hooks/use_popover_window';

const READ_ERROR = 'Failed to read popover window visibility';
const SUBSCRIPTION_ERROR = 'Failed to subscribe to popover focus changes';

const boundary = vi.hoisted(() => ({
  get_current_window: vi.fn(),
  resize_window: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: boundary.get_current_window,
}));

vi.mock('../src/services/backend', () => ({
  backend: { resizeWindow: boundary.resize_window },
}));

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
}

type FocusCallback = (event: { payload: boolean }) => void;

interface Harness {
  focus_callback(): FocusCallback;
  read: Deferred<boolean>;
  renders: boolean[];
  stop: Mock;
  subscription: Deferred<() => void>;
}

function deferred<T>(): Deferred<T> {
  let reject!: (reason: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolve_promise, reject_promise) => {
    reject = reject_promise;
    resolve = resolve_promise;
  });
  return { promise, reject, resolve };
}

class ResizeObserverStub {
  disconnect(): void {}
  observe(): void {}
}

function Probe({ renders }: { renders: boolean[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  renders.push(usePopoverWindow(ref, []));
  return null;
}

const renderers = new Set<ReactTestRenderer>();

async function mount_probe(renders: boolean[]): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Probe, { renders }));
    await Promise.resolve();
  });
  renderers.add(renderer);
  return renderer;
}

async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount());
  renderers.delete(renderer);
}

function harness(options: { read_throw?: Error; subscription_throw?: Error } = {}): Harness {
  const read = deferred<boolean>();
  const subscription = deferred<() => void>();
  const stop = vi.fn();
  const renders: boolean[] = [];
  let callback: FocusCallback | null = null;
  const is_visible = options.read_throw
    ? vi.fn(() => { throw options.read_throw; })
    : vi.fn(() => read.promise);
  const on_focus_changed = vi.fn((next_callback: FocusCallback) => {
    callback = next_callback;
    if (options.subscription_throw) throw options.subscription_throw;
    return subscription.promise;
  });
  boundary.get_current_window.mockReturnValue({
    isVisible: is_visible,
    onFocusChanged: on_focus_changed,
  });
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  return {
    focus_callback: () => {
      if (!callback) throw new Error('focus callback was not registered');
      return callback;
    },
    read,
    renders,
    stop,
    subscription,
  };
}

function matching_calls(spy: ReturnType<typeof vi.spyOn>, message: string): unknown[][] {
  return spy.mock.calls.filter(([first]) => first === message);
}

function expect_safe_error(
  spy: ReturnType<typeof vi.spyOn>,
  message: string,
  raw: Error,
): void {
  expect(matching_calls(spy, message)).toEqual([[message]]);
  const arguments_flat = spy.mock.calls.flat();
  expect(arguments_flat).not.toContain(raw);
  const rendered_arguments = arguments_flat.map((value) => String(value)).join('\n');
  expect(rendered_arguments).not.toContain(raw.message);
  if (raw.stack) expect(rendered_arguments).not.toContain(raw.stack);
}

beforeEach(() => {
  boundary.get_current_window.mockReset();
  boundary.resize_window.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(async () => {
  for (const renderer of [...renderers]) await unmount(renderer);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('popover visibility lifecycle', () => {
  it('keeps the browser path visible without accessing Tauri', async () => {
    vi.stubGlobal('window', undefined);
    const renders: boolean[] = [];
    await mount_probe(renders);
    expect(renders).toEqual([false, true]);
    expect(boundary.get_current_window).not.toHaveBeenCalled();
  });

  it.each([true, false])('commits initial visibility %s', async (visible) => {
    const test = harness();
    await mount_probe(test.renders);
    await settle(() => test.read.resolve(visible));
    expect(test.renders.at(-1)).toBe(visible);
  });

  it('fails closed and safely logs an initial read rejection', async () => {
    const raw = new Error('private read rejection');
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness();
    await mount_probe(test.renders);
    await settle(() => test.read.reject(raw));
    expect(test.renders).toEqual([false]);
    expect_safe_error(error_spy, READ_ERROR, raw);
  });

  it('fails closed and safely logs a synchronous read throw', async () => {
    const raw = new Error('private read throw');
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness({ read_throw: raw });
    await mount_probe(test.renders);
    expect(test.renders).toEqual([false]);
    expect_safe_error(error_spy, READ_ERROR, raw);
  });

  it('treats mounted focus changes as authoritative', async () => {
    const test = harness();
    await mount_probe(test.renders);
    await settle(() => test.focus_callback()({ payload: true }));
    await settle(() => test.focus_callback()({ payload: false }));
    expect(test.renders).toEqual([false, true, false]);
  });

  it.each([
    [true, true], [true, false], [true, 'reject'],
    [false, true], [false, false], [false, 'reject'],
  ] as const)('keeps focus %s after late read %s', async (focused, terminal) => {
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness();
    await mount_probe(test.renders);
    await settle(() => test.focus_callback()({ payload: focused }));
    const raw = new Error('late read payload');
    await settle(() => terminal === 'reject' ? test.read.reject(raw) : test.read.resolve(terminal));
    expect(test.renders.at(-1)).toBe(focused);
    expect(matching_calls(error_spy, READ_ERROR)).toHaveLength(terminal === 'reject' ? 1 : 0);
    expect(error_spy.mock.calls.flat()).not.toContain(raw);
  });

  it.each([
    ['reject', true], ['reject', false], ['reject', 'read_reject'],
    ['throw', true], ['throw', false], ['throw', 'read_reject'],
  ] as const)('keeps subscription %s fail-closed after late read %s', async (mode, terminal) => {
    const subscription_raw = new Error(`private subscription ${mode}`);
    const read_raw = new Error('private late read');
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness(mode === 'throw' ? { subscription_throw: subscription_raw } : {});
    await mount_probe(test.renders);
    if (mode === 'reject') await settle(() => test.subscription.reject(subscription_raw));
    await settle(() => terminal === 'read_reject'
      ? test.read.reject(read_raw)
      : test.read.resolve(terminal));
    expect(test.renders.at(-1)).toBe(false);
    expect_safe_error(error_spy, SUBSCRIPTION_ERROR, subscription_raw);
    expect(matching_calls(error_spy, READ_ERROR)).toHaveLength(terminal === 'read_reject' ? 1 : 0);
    expect(error_spy.mock.calls.flat()).not.toContain(read_raw);
  });

  it('closes a previously visible window when subscription rejects', async () => {
    const raw = new Error('private subscription rejection');
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness();
    await mount_probe(test.renders);
    await settle(() => test.read.resolve(true));
    await settle(() => test.subscription.reject(raw));
    expect(test.renders).toEqual([false, true, false]);
    expect_safe_error(error_spy, SUBSCRIPTION_ERROR, raw);
  });

  it.each(['resolve', 'reject'] as const)('ignores late read %s after cleanup', async (terminal) => {
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness();
    const renderer = await mount_probe(test.renders);
    await unmount(renderer);
    const render_count = test.renders.length;
    await settle(() => terminal === 'resolve'
      ? test.read.resolve(true)
      : test.read.reject(new Error('late read')));
    expect(test.renders).toHaveLength(render_count);
    expect(matching_calls(error_spy, READ_ERROR)).toHaveLength(0);
  });

  it('stops a subscription that resolves after cleanup exactly once', async () => {
    const test = harness();
    const renderer = await mount_probe(test.renders);
    await unmount(renderer);
    await settle(() => test.subscription.resolve(test.stop));
    expect(test.stop).toHaveBeenCalledTimes(1);
  });

  it('ignores a subscription rejection after cleanup', async () => {
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness();
    const renderer = await mount_probe(test.renders);
    await unmount(renderer);
    await settle(() => test.subscription.reject(new Error('late subscription')));
    expect(matching_calls(error_spy, SUBSCRIPTION_ERROR)).toHaveLength(0);
  });

  it('stops a registered subscription on normal cleanup exactly once', async () => {
    const test = harness();
    const renderer = await mount_probe(test.renders);
    await settle(() => test.subscription.resolve(test.stop));
    expect(test.stop).not.toHaveBeenCalled();
    await unmount(renderer);
    expect(test.stop).toHaveBeenCalledTimes(1);
  });

  it('ignores a captured focus callback after cleanup', async () => {
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness();
    const renderer = await mount_probe(test.renders);
    const callback = test.focus_callback();
    await unmount(renderer);
    const render_count = test.renders.length;
    const error_count = error_spy.mock.calls.length;
    await settle(() => callback({ payload: true }));
    expect(test.renders).toHaveLength(render_count);
    expect(error_spy).toHaveBeenCalledTimes(error_count);
  });

  it('records independent read and subscription failures once each', async () => {
    const read_raw = new Error('private read');
    const subscription_raw = new Error('private subscription');
    const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = harness();
    await mount_probe(test.renders);
    await settle(() => test.read.reject(read_raw));
    await settle(() => test.subscription.reject(subscription_raw));
    expect_safe_error(error_spy, READ_ERROR, read_raw);
    expect_safe_error(error_spy, SUBSCRIPTION_ERROR, subscription_raw);
  });
});

function fail(reason: string): never {
  throw new Error(reason);
}

function direct_method_call(node: ts.Node, owner: string, method: string): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === owner
    && node.expression.name.text === method;
}

function validate_focus_guard(source: string): void {
  const file = ts.createSourceFile('use_popover_window.ts', source, ts.ScriptTarget.Latest, true);
  const registrations: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (direct_method_call(node, 'appWindow', 'onFocusChanged')) registrations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (registrations.length !== 1) fail('expected one direct focus registration');
  const registration = registrations[0];

  let effect: ts.ArrowFunction | undefined;
  let nearest_function: ts.Node | undefined;
  for (let node: ts.Node | undefined = registration.parent; node; node = node.parent) {
    if (!nearest_function && ts.isFunctionLike(node)) nearest_function = node;
    if (ts.isArrowFunction(node)
      && ts.isCallExpression(node.parent)
      && ts.isIdentifier(node.parent.expression)
      && node.parent.expression.text === 'useEffect'
      && node.parent.arguments[0] === node) {
      effect = node;
      break;
    }
  }
  if (!effect) fail('focus registration must be inside the real visibility effect');
  if (nearest_function !== effect) fail('focus registration must not be nested in a dead function');
  const then_property = registration.parent;
  const then_call = then_property.parent;
  const statement = then_call.parent;
  const try_block = statement.parent;
  const try_statement = try_block.parent;
  const direct_registration = ts.isPropertyAccessExpression(then_property)
    && then_property.expression === registration
    && then_property.name.text === 'then'
    && ts.isCallExpression(then_call)
    && then_call.expression === then_property
    && ts.isExpressionStatement(statement)
    && statement.expression === then_call
    && ts.isBlock(try_block)
    && ts.isTryStatement(try_statement)
    && try_statement.tryBlock === try_block
    && ts.isBlock(effect.body)
    && try_statement.parent === effect.body;
  if (!direct_registration) fail('focus registration must be a direct visibility-effect try statement');
  let read_calls = 0;
  let current_window_bindings = 0;
  const inspect_effect = (node: ts.Node) => {
    if (direct_method_call(node, 'appWindow', 'isVisible')) read_calls += 1;
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'appWindow'
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === 'getCurrentWindow') current_window_bindings += 1;
    ts.forEachChild(node, inspect_effect);
  };
  inspect_effect(effect.body);
  if (read_calls !== 1 || current_window_bindings !== 1) fail('registration is not bound to the real window effect');

  const callback = registration.arguments[0];
  if (!callback || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) {
    fail('focus callback must be an inline block arrow');
  }
  const parameter = callback.parameters[0]?.name;
  if (!parameter || !ts.isObjectBindingPattern(parameter) || parameter.elements.length !== 1) {
    fail('focus callback must bind the payload');
  }
  const binding = parameter.elements[0];
  if (!binding.propertyName || !ts.isIdentifier(binding.propertyName)
    || binding.propertyName.text !== 'payload' || !ts.isIdentifier(binding.name)
    || binding.name.text !== 'focused') fail('focus callback payload binding is wrong');

  const statements = callback.body.statements;
  if (statements.length !== 3 || !ts.isIfStatement(statements[0])) {
    fail('mounted guard must be the first executable statement');
  }
  const guard = statements[0];
  const exact_condition = ts.isPrefixUnaryExpression(guard.expression)
    && guard.expression.operator === ts.SyntaxKind.ExclamationToken
    && ts.isIdentifier(guard.expression.operand)
    && guard.expression.operand.text === 'mounted';
  const exact_return = ts.isReturnStatement(guard.thenStatement)
    || (ts.isBlock(guard.thenStatement)
      && guard.thenStatement.statements.length === 1
      && ts.isReturnStatement(guard.thenStatement.statements[0]));
  if (!exact_condition || !exact_return || guard.elseStatement) fail('mounted guard must fail closed exactly');

  const assignment_statement = statements[1];
  const assignment = ts.isExpressionStatement(assignment_statement) ? assignment_statement.expression : undefined;
  if (!assignment || !ts.isBinaryExpression(assignment)
    || assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    || !ts.isIdentifier(assignment.left) || assignment.left.text !== 'read_superseded'
    || assignment.right.kind !== ts.SyntaxKind.TrueKeyword) fail('focus precedence assignment is wrong');
  const setter_statement = statements[2];
  const setter = ts.isExpressionStatement(setter_statement) ? setter_statement.expression : undefined;
  if (!setter || !ts.isCallExpression(setter) || !ts.isIdentifier(setter.expression)
    || setter.expression.text !== 'setWindowVisible' || setter.arguments.length !== 1
    || !ts.isIdentifier(setter.arguments[0]) || setter.arguments[0].text !== 'focused') {
    fail('focus setter is wrong');
  }
}

function replace_exact(source: string, target: string, replacement: string): string {
  if (!source.includes(target)) fail(`fixture target missing: ${target}`);
  return source.replace(target, replacement);
}

function replace_live_registration_with_dead_decoy(source: string): string {
  const computed_live_path = replace_exact(
    source,
    '      appWindow.onFocusChanged(({ payload: focused }) => {\n        if (!mounted) return;',
    "      appWindow['onFocusChanged'](({ payload: focused }) => {\n        setWindowVisible(focused);",
  );
  return replace_exact(
    computed_live_path,
    "    try {\n      appWindow['onFocusChanged']",
    '    if (false) {\n      appWindow.onFocusChanged(({ payload: focused }) => {\n        if (!mounted) return;\n        read_superseded = true;\n        setWindowVisible(focused);\n      });\n    }\n\n    try {\n      appWindow[\'onFocusChanged\']',
  );
}

describe('focus callback source gate', () => {
  const source = readFileSync(new URL('../src/hooks/use_popover_window.ts', import.meta.url), 'utf8');

  it('accepts the real mounted-first callback', () => {
    expect(() => validate_focus_guard(source)).not.toThrow();
  });

  const guard = '        if (!mounted) return;\n        read_superseded = true;\n        setWindowVisible(focused);';
  const fixtures = [
    ['missing guard', replace_exact(source, '        if (!mounted) return;\n', '')],
    ['guard after setter', replace_exact(source, guard,
      '        read_superseded = true;\n        setWindowVisible(focused);\n        if (!mounted) return;')],
    ['wrong mounted identifier', replace_exact(source, guard,
      guard.replace('if (!mounted) return;', 'if (!active) return;'))],
    ['non-return guard', replace_exact(source, guard,
      guard.replace('if (!mounted) return;', 'if (!mounted) setWindowVisible(false);'))],
    ['else branch', replace_exact(source, guard,
      guard.replace('if (!mounted) return;', 'if (!mounted) return; else read_superseded = true;'))],
    ['wrong payload', replace_exact(source, 'setWindowVisible(focused);', 'setWindowVisible(!focused);')],
    ['computed live registration with dead direct decoy', replace_live_registration_with_dead_decoy(source)],
  ] as const;

  it.each(fixtures)('rejects %s', (_name, mutated_source) => {
    expect(() => validate_focus_guard(mutated_source)).toThrow();
  });
});

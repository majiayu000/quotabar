import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ProjectPicker from '../src/components/ProjectPicker';
import type { AnalysisReport } from '../src/services/backend';

const report: AnalysisReport = { since: '2026-11-01', until: '2026-11-02', timezone: 'UTC', generated_at: '2026-11-02T10:00:00Z', available_models: [], available_projects: ['/work/app', '/work/other'], hourly: [], summaries: [], projects: [], history: [], errors: [] };

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

describe('project picker focus containment', () => {
  // The engine behavior itself is exercised in WebKit by scripts/check_project_picker.mjs.
  it('stays open for a mouse press that WebKit turns into focus on the picker itself', async () => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const onChange = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(ProjectPicker, { report, value: 'all', onChange })); });
    const picker = () => renderer.root.findByProps({ className: 'project-picker' });
    const popovers = () => renderer.root.findAllByProps({ className: 'project-picker-popover' });
    const toggle = () => act(async () => renderer.root.findByProps({ className: 'project-picker-trigger' }).props.onClick());

    // macOS WebKit never focuses a clicked <button>; focus moves to the nearest focusable ancestor instead.
    expect(picker().props.tabIndex).toBe(-1);
    const node = { contains: (other: unknown) => other === node };

    await toggle();
    await act(async () => picker().props.onBlur({ currentTarget: node, relatedTarget: node }));
    expect(popovers()).toHaveLength(1);
    await act(async () => renderer.root.findByProps({ title: '/work/app' }).props.onClick());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('/work/app');
    expect(popovers()).toHaveLength(0);

    await toggle();
    expect(popovers()).toHaveLength(1);
    await act(async () => picker().props.onBlur({ currentTarget: node, relatedTarget: null }));
    expect(popovers()).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});

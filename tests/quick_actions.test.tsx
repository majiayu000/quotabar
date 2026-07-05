import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import QuickActions from '../src/components/QuickActions';

describe('QuickActions', () => {
  test('renders copy, pause and usage page actions', () => {
    const html = renderToStaticMarkup(
      <QuickActions
        statusText="Claude 38% — via QuotaBar"
        paused={false}
        onTogglePause={() => {}}
        onOpenUsagePage={() => {}}
      />,
    );

    expect(html).toContain('Copy status');
    expect(html).toContain('Pause polling');
    expect(html).toContain('Usage page ↗');
    expect(html).toContain('aria-pressed="false"');
  });

  test('shows resume label when polling is paused', () => {
    const html = renderToStaticMarkup(
      <QuickActions
        statusText="Claude 38% — via QuotaBar"
        paused={true}
        onTogglePause={() => {}}
        onOpenUsagePage={() => {}}
      />,
    );

    expect(html).toContain('Resume polling');
    expect(html).not.toContain('Pause polling');
    expect(html).toContain('aria-pressed="true"');
  });
});

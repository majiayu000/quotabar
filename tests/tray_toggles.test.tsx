import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TrayToggles from '../src/components/TrayToggles';

describe('TrayToggles', () => {
  test('tray status text is separate from the switch control', () => {
    const html = renderToStaticMarkup(
      <TrayToggles
        claudeEnabled={true}
        codexEnabled={true}
        claudeCanDisable={true}
        codexCanDisable={true}
        claudeConnected={true}
        codexConnected={false}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain('<div class="dock-toggle tray-toggle">');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Claude Tray toggle"');
    expect(html).toContain('aria-label="Codex Tray toggle"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('<label class="dock-toggle tray-toggle"');
    expect(html).toContain('Requires Codex App or CLI login');
  });

  test('disables the only remaining enabled tray toggle', () => {
    const html = renderToStaticMarkup(
      <TrayToggles
        claudeEnabled={true}
        codexEnabled={false}
        claudeCanDisable={false}
        codexCanDisable={true}
        claudeConnected={true}
        codexConnected={false}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Claude Tray toggle"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('disabled=""');
  });
});

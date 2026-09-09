import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace window launch', () => {
  it('does not open the analysis workspace on app launch', () => {
    const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as {
      app: { windows: Array<{ label: string; visible: boolean }> };
    };
    const analysis = config.app.windows.find((window) => window.label === 'analysis');
    const tray = config.app.windows.find((window) => window.label === 'main');
    expect(analysis?.visible).toBe(false);
    expect(tray?.visible).toBe(false);
  });

  it('reopens the quota popover from Dock instead of the workspace', () => {
    const source = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
    expect(source).toContain('open_quota_popover');
    expect(source).not.toMatch(/Reopen[\s\S]*show_workspace/);
  });
});

#!/usr/bin/env node
// Captures README demo screenshots from a production Vite build of the React UI
// in Chromium (no dev-only StrictMode double effects),
// backed by the illustrative IPC mock in scripts/demo/mock_backend.mjs.
// Usage: node scripts/capture_demo_screenshots.mjs [outputDir]
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { installMockBackend } from './demo/mock_backend.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(root, process.argv[2] ?? 'docs/assets');
const NOW_ISO = '2026-10-05T09:30:00.000Z';
const PORT = 1460;

const SHOTS = [
  { name: 'quotabar-demo-tray-overview-light', query: '?window=tray', theme: 'light', tab: 'all', viewport: { width: 340, height: 582 } },
  { name: 'quotabar-demo-tray-overview-dark', query: '?window=tray', theme: 'dark', tab: 'all', viewport: { width: 340, height: 582 } },
  { name: 'quotabar-demo-tray-codex-light', query: '?window=tray', theme: 'light', tab: 'all', provider: 'codex', viewport: { width: 340, height: 582 } },
  { name: 'quotabar-demo-workspace-light', query: '', theme: 'light', tab: 'all', viewport: { width: 1280, height: 800 } },
  { name: 'quotabar-demo-workspace-dark', query: '', theme: 'dark', tab: 'all', viewport: { width: 1280, height: 800 } },
];

// Build into a temp dir so the capture never touches or depends on dist/.
const buildDir = await mkdtemp(path.join(os.tmpdir(), 'quotabar-demo-'));
const configFile = path.join(root, 'vite.config.ts');
await build({ root, configFile, logLevel: 'warn', build: { outDir: buildDir, emptyOutDir: true } });
const server = await preview({
  root,
  configFile,
  logLevel: 'warn',
  build: { outDir: buildDir },
  preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
});
const browser = await chromium.launch();
try {
  await mkdir(outputDir, { recursive: true });
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: 2,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: shot.theme === 'dark' ? 'dark' : 'light',
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NOW_ISO));
    await page.addInitScript(installMockBackend, { nowIso: NOW_ISO });
    await page.addInitScript(({ theme, tab }) => {
      localStorage.setItem('claude-quota-theme', theme);
      localStorage.setItem('claude-quota-tab', tab);
      localStorage.setItem('quotabar-locale', 'en');
    }, shot);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${PORT}/${shot.query}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    if (shot.provider) {
      await page.locator(`.provider-card[data-provider="${shot.provider}"]`).click();
      await page.waitForTimeout(1500);
    }
    if (errors.length) throw new Error(`${shot.name}: ${errors.join('; ')}`);
    const file = path.join(outputDir, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`captured ${path.relative(root, file)}`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
  await rm(buildDir, { recursive: true, force: true });
}

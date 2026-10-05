# Demo Proof

The committed README screenshots are:

```text
docs/assets/quotabar-demo-tray-overview-light.png   menu bar overview, light, 340x582
docs/assets/quotabar-demo-tray-overview-dark.png    menu bar overview, dark, 340x582
docs/assets/quotabar-demo-tray-codex-light.png      Codex provider detail, light, 340x582
docs/assets/quotabar-demo-workspace-light.png       desktop workspace overview, light, 1280x800
docs/assets/quotabar-demo-workspace-dark.png        desktop workspace overview, dark, 1280x800
```

All are captured at device scale factor 2.

The current set was captured on 2026-10-05 for QuotaBar `v0.5.9` from a
production Vite build of the React UI served by `vite preview` and rendered in
headless Chromium.

Scope:

- The data is illustrative. `scripts/demo/mock_backend.mjs` replaces the Tauri
  IPC bridge (`window.__TAURI_INTERNALS__`) with fixed, invented responses for
  quota, cost and usage-analysis commands. The page clock is pinned to
  `2026-10-05T09:30:00Z` and the timezone to UTC, so reset countdowns and
  charts are deterministic.
- No provider credentials, cookies, sessions, local auth files, account ids,
  emails or local usage records are read or shown. Project paths and session
  titles are placeholders.
- The mock is injected only by the capture script through Playwright
  `addInitScript`. Nothing under `src/` imports it, so it is not in the
  application bundle. Check with `npm run build && grep -r "Illustrative demo source" dist`
  (expect no matches).
- The Codex "Weekly token capacity" card uses the community reference data
  bundled with the app (`src/services/codex_weekly_reference.json`), not the
  mock.
- It does not run inside the Tauri desktop shell or exercise the Rust backend,
  native tray icon, provider connectivity, or signed/notarized artifacts.
- Desktop widget and notification artwork in redesign docs is static preview
  material, not current runtime functionality.

Refresh command (requires `npm ci`; Playwright uses its Chromium build, install
it once with `npx playwright install chromium` if missing):

```bash
npm run demo:screenshots
```

The script builds the frontend into a temporary directory, serves it on
`127.0.0.1:1460`, and overwrites the files above. Review the images before
committing, and keep the README "Demo Proof" date and version in sync.

## Current landing preview

`landing/assets/quota-tray-preview.png` captures the current React tray at
340×582 after the final tray footer and height corrections. Its quota values come from explicit
browser-only test fixtures, not provider accounts. It demonstrates layout and
remaining-quota semantics; it does not demonstrate native backend connectivity.

## getdesign.md redesign (2026-09-10)

The current preview is captured from the redesigned React menu panel at 340×582
with explicit illustrative fixtures. The Linear reference and application
adaptation are recorded in DESIGN.md. Verification covered light/dark desktop,
760×560 layouts, 280px provider panels, settings, session/export dialogs and
empty/stale states. The fixture never writes account records and is not included
in the application bundle.

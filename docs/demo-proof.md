# Demo Proof

The committed visual proof asset is:

```text
docs/assets/quotabar-no-provider-preview.png
```

The current capture was refreshed for QuotaBar `v0.4.0` on 2026-08-31 from
the production React UI in browser preview at `http://127.0.0.1:1420` with a
`340x580` viewport.

Scope:

- It does not run inside the Tauri desktop shell or desktop backend.
- It captures the default Claude tab browser-preview state, where backend
  calls are expected to show the unavailable-backend banner.
- It does not use provider credentials, cookies, sessions, or local auth files.
- It does not seed or fake provider quota percentages.
- It should show the popover shell, provider switcher, backend-unavailable
  banner, and footer action buttons.
- It is not proof of signed or notarized desktop artifacts.
- Desktop widget and notification artwork in redesign docs is static preview
  material, not current runtime functionality.

Refresh command:

```bash
npm run dev -- --host 127.0.0.1
npx playwright screenshot --wait-for-timeout=3500 --viewport-size=340,580 http://127.0.0.1:1420 docs/assets/quotabar-no-provider-preview.png
```


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

# Demo Proof

The committed visual proof asset is:

```text
docs/assets/quotabar-no-provider-preview.png
```

It is captured from the production React UI in browser preview at `http://127.0.0.1:1420` with a `320x580` viewport.

Scope:

- It does not run inside the Tauri desktop shell.
- It does not use provider credentials, cookies, sessions, or local auth files.
- It does not seed or fake provider quota percentages.
- It should show an explicit desktop-backend-unavailable error, provider cards, settings summary, and action buttons.

Refresh command:

```bash
npm run dev -- --host 127.0.0.1
npx playwright screenshot --wait-for-timeout=3500 --viewport-size=320,580 http://127.0.0.1:1420 docs/assets/quotabar-no-provider-preview.png
```

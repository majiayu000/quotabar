# Demo Proof

The committed visual proof asset is:

```text
docs/assets/quotabar-no-provider-preview.png
```

It is captured from the production React UI in browser preview at `http://127.0.0.1:1420` with a `340x580` viewport.

Scope:

- It does not run inside the Tauri desktop shell.
- It does not use provider credentials, cookies, sessions, or local auth files.
- It does not seed or fake provider quota percentages.
- It should show the glass overview shell, provider cards, settings summary, and action buttons.
- Desktop widget and notification artwork in redesign docs is static preview material, not current runtime functionality.

Refresh command:

```bash
npm run dev -- --host 127.0.0.1
npx playwright screenshot --wait-for-timeout=3500 --viewport-size=340,580 http://127.0.0.1:1420 docs/assets/quotabar-no-provider-preview.png
```

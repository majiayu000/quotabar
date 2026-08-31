# Grok Build provider — tech

## Data

`GrokData` from `src-tauri/src/services/grok.rs`:

- Identity: `email`, `planType` from billing `subscriptionTier` (not `auth_mode`).
- Pool: `percentage` (`creditUsagePercent`, else sum of product percents), `resetAt` (`currentPeriod.end` then `billingPeriodEnd`), `periodStartedAt` (`currentPeriod.start`), `periodType` / `periodLabel`.
- `valueEstimate` / `valueEstimateError`: request a ccstats `UsageSource::Grok` summary for the exact UTC `[period start, now]` timestamp range, then scale its per-inference API-equivalent USD and token totals by the official used percent. Reject parse errors or incomplete inference coverage. Isolated from pool % rendering.
- `products[]`: `{ product, label, usagePercent }` mapped from `GrokBuild` / `PRODUCT_GROK_BUILD` / etc.
- `extra`: cents for on-demand used/cap and prepaid remaining; UI hides when all zero.

Auth: issuer-keyed objects in `auth.json`; pick a non-expired `key`. Send `Authorization: Bearer`, `x-xai-token-auth: xai-grok-cli`, `Accept: application/json`. Optional `x-userid` when present. Never log those headers.

Cache 120s. Last-good on transient OS errors.

## Files

Backend: `grok.rs` (new), `domain/models.rs`, `commands.rs`, `lib.rs`, `services/mod.rs`, `tray.rs`, `tray_icon.rs`, `link.rs`, `icons/tray-badges/grok.png`.

Frontend: `types/models.ts`, `backend.ts`, `tray_visibility.ts`, `service_meta.ts`, `provider_summary.ts`, `App.tsx`, `GrokPanel.tsx` (new), `TabSwitcher.tsx`, `ProviderIcon.tsx`.

Tests: grok parser unit tests; provider-map fixtures add `grok`; Grok panel race driver; switcher all-hidden includes grok.

## Security

Read-only credentials. No refresh. Errors must not include tokens, paths to auth.json contents, or raw JSON bodies.

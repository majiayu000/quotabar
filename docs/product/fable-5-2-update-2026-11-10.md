# Fable 5.2 support check — 2026-11-10

Decision: keep the existing shared Fable quota parser and public price resolver;
remove the version-specific Fable 5 label. Ship the local update as 0.7.4.
The acceptance target is correct quota identity and API-equivalent accounting,
not a new per-model allowance. Do not add guessed quota keys or prices.

## Evidence

- The authenticated OAuth usage response still identifies the scoped weekly
  window as `group=weekly`, `kind=weekly_scoped`, and
  `scope.model.display_name=Fable`. The existing parser reads this shape.
- [Anthropic's Fable 5.2 documentation](https://platform.claude.com/docs/en/models/fable-5-2/overview)
  lists `claude-fable-5-2`: input $8, output $40, cache read $0.20,
  5-minute cache write $10, and 1-hour cache write $16 per million tokens.
- The live LiteLLM catalog used by ccstats contains those exact standard rates.
  No SDK dependency change or additional price table is required.
- The isolated app-service fixture downloads the real catalog and prices
  10,000 input, 2,000 output, 100,000 cache-read, 3,000 5-minute cache-write,
  and 2,000 1-hour cache-write tokens at $0.242 in both summary and daily history.
  These are synthetic usage records, not a provider bill.
- The Chinese dark preview shows `Fable`, 70% remaining for a 30%-used fixture,
  and the Fable weekly reset timeline. Frontend regression checks cover the
  shared label, tray ranking, recovery, and localization. Rust checks cover
  quota parsing, cost aggregation, and catalog pricing.

## Delivery and limits

- Built and installed `/Applications/QuotaBar.app` version 0.7.4. Its binary
  matches the local build. Refreshed the existing public price cache.
- Previous app and price cache are retained under
  `~/Library/Application Support/QuotaBar/backups/2026-11-10-fable-5-2/`.
- Preview assets are in
  `~/Documents/claude-pages/quotabar/2026-11-10-fable-5-2/`.
- The installed native app's UI was readable, but its popover disappeared on
  focus change before the Fable view could be inspected. Native Fable-card
  visibility and Windows runtime remain unverified.
- Adjacent checks: shared Fable quota parsing, Codex Sol pricing, unknown-model
  handling, and malformed price-cache errors remain covered. Fast-mode premium
  pricing and a first launch offline without a Fable 5.2 price cache were not
  verified. ccstats 0.12 has no bundled Fable 5.2 fallback rate.
- No public release, tag, remote deployment, or PR merge was performed.

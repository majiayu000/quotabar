# Upstream ccstats GH-27 Tech Note: Local Cost Multi-Range Summary

## Proposed Design

Upgrade QuotaBar's ccstats dependency to a revision containing upstream GH27 and import:

- `summarize_cost_ranges`
- `MultiSummaryOptions`

In `build_cost_overview`, build the three existing `UsageRange` values, call `summarize_cost_ranges` once, then map the ordered returned summaries back into QuotaBar's existing `CostRangeSummary` structs with the current labels.

The mapping layer must fail if the SDK returns an unexpected number of summaries. A missing or mismatched SDK result should be an error, not a partial UI fallback.

## Test Plan

- Unit-test the mapping layer for stable QuotaBar range keys and labels.
- Unit-test mismatch handling for an unexpected SDK summary count.
- Run `cargo check --manifest-path src-tauri/Cargo.toml`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- Run `npx tsc --noEmit`.
- Run `npm test -- --run`.

## Rollback Plan

Revert the ccstats revision and the `cost.rs` multi-range integration. The existing cache and per-range single summary path can be restored from git history if the upstream SDK API changes.

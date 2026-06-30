# GH-27 Product Spec: Local Cost Multi-Range Summary

## Goals

- Use the ccstats GH27 multi-range SDK path for QuotaBar local cost summaries.
- Keep the existing QuotaBar UI response shape for Today, This Week, and This Month.
- Reduce cold or forced local cost refresh work from repeated per-range scans to one shared ccstats scan.

## Non-Goals

- Do not change QuotaBar's visible cost UI.
- Do not add new providers or expose new cost fields.
- Do not change tray behavior or existing quota polling behavior.

## Acceptance Criteria

- QuotaBar depends on a ccstats revision that includes GH27 `summarize_cost_ranges`.
- `src-tauri/src/services/cost.rs` calls the multi-range SDK once for Today, This Week, and This Month instead of looping over single-range summaries.
- The returned `CostOverview` still contains the same range keys and labels: `today`, `week`, and `month`.
- Cache behavior remains unchanged: non-forced calls can return the five-minute cached overview and forced calls rebuild it.
- Fresh Rust and TypeScript verification passes.

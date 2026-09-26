# Usage product delivery status — 2026-09-27

This records the product-boundary change and source-branch validation. It is not
a release announcement or evidence of Windows native acceptance.

## Implemented in this change

- Define agent-sessions as the native parser/provenance layer, ccstats as the
  accounting/price/CLI/SDK layer, and QuotaBar as the tray/desktop/alerts/settings
  product. ccstats' separate tray plan is withdrawn; its current desktop stays
  maintained behind an explicit handover gate.
- Adopt ccstats 0.9.1 (stable model-alias price precedence) and lock
  agent-sessions 0.2.1 from crates.io. Existing SDK-versioned caches invalidate
  older cost snapshots.
- Add shared 100%/115%/130% text sizes with storage failure reporting, and fit
  the scroll area to constrained tray windows while measuring intrinsic content.
- Put installer/first-run guidance ahead of developer setup, distinguish
  Antigravity availability from quota support, and use QuotaBar page branding.
- Run frontend, build and Rust checks in CI on macOS and Windows using the
  checked-in Cargo lockfile. A workflow definition is not a passing remote run.

## Local verification

| Surface | Completed check |
|---|---|
| agent-sessions | Rust 1.88 all-target contract/fixture tests and README rustdoc |
| ccstats | Rust 1.95 pricing tests: 129 passed |
| QuotaBar SDK integration | Rust 1.95 tests: 143 passed, 5 ignored live/manual/helper cases; isolated synthetic child verification is invoked by its parent test |
| QuotaBar frontend | 631 tests passed; TypeScript and production asset build passed |
| Release metadata | All app manifests remain 0.5.4; no tag or installer published |
| Readability | Browser settings checks, cross-tab synchronization and reload; see [scope and Windows gate](../../specs/GH186/text-size.md) |

## Remaining delivery gates

1. Native Windows 10/11 acceptance for tray placement, DPI changes and text size
   ([matrix](../../specs/GH186/tasks.md)). Browser and unit tests cannot close it.
2. Compare ccstats desktop's source diagnostics, investigation and device
   snapshot workflows before retiring any feature. QuotaBar parity is not yet
   certified, and no data migration is performed by this change.
3. Refresh the public demo using a current native build and deliberately curated
   data. The existing README screenshot remains explicitly labeled v0.4.0
   browser preview; it is not relabeled as a new runtime capture.
4. Review/merge this source change, then perform normal release verification and
   distribution. The currently installed app is not updated by repository edits.
5. External first-run/retention and paid-use validation remain product work,
   not claims established by these tests. No telemetry or paid service is added.

Antigravity quota support is pending independently. It is not silently included
in this delivery or represented as zero remaining quota.

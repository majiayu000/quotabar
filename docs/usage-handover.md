# Usage trust and desktop handover — 2026-10-07

QuotaBar owns tray, desktop analysis, provider login recovery, notifications and
settings. agent-sessions reads native Claude/Codex records; ccstats owns statistics,
deduplication, pricing and report contracts. This task adds no independent collector
or pricing table.

## Included changes

- Source discovery errors remain visible in analysis alongside any readable portion.
  Source selection preserves the SDK's existing aliases. Explicit inspection of a
  missing source reports its diagnostic rather than a successful empty total.
- With a failed source or malformed records, daily cost/tokens remain unknown or
  lower bounds. A clean empty day may still be a real zero.
- Session details and project sessions display original Claude/Codex usage files
  when returned by ccstats. Paths reflect the same selected range/model/project;
  pricing source and API-equivalent coverage stay beside the cost.
- Missing file provenance is explicit. Other adapters lacking reliable locations
  are not assigned guessed paths. This is usage provenance, not invoice proof.

The provenance and additional native discovery diagnostics are implemented in the
parallel ccstats change. This checkout keeps its published SDK dependency; its
lockfile currently resolves ccstats 0.9.1. The new SDK must be released and the
lockfile refreshed before installed QuotaBar receives these additions. Local
Cargo overrides are verification only and must not be shipped as dependencies.

## Windows feedback #186

[#194](https://github.com/majiayu000/quotabar/pull/194) already added persistent
100%, 125% and 150% interface sizing for both tray and analysis windows. Use
Settings → Display → Interface size. This scales text and controls together.
[#186](https://github.com/majiayu000/quotabar/issues/186) remains open; the issue's
last maintainer report distinguishes Windows 11/4K/150% testing from the still
unconfirmed Windows 10, 27-inch 2K scenario.

The geometry suite covers target-monitor DPI, negative secondary monitor origins,
taskbar placement, auto-hide and viewport clamping. The explicit 2560×1440 matrix
combines system DPI 100/125/150/200% with app zoom 100/125/150%. These are synthetic
geometry fixtures, not a Windows device result.

A Windows peer was discovered using Tailscale status. `Tailscale ssh ... whoami`
failed at host-key verification before remote commands ran. No alternate access
method or desktop automation was used. A verified SSH identity is needed to resume.

Native acceptance remains: Windows 10 on a physical 27-inch 2560×1440 display,
system display scaling and text-only scaling, bottom/side/auto-hidden taskbar,
and moving between displays with different DPI. Check both windows, persistence
after restart, scrolling at maximal zoom, and tray alignment on repeated opening.
Do not close #186 based on these fixtures.

## Retained desktop workflows

QuotaBar has source diagnostics, session/project/model analysis, history, data
quality, cost evidence and provider recovery. ccstats desktop retains live
monitoring, model/tool investigation, limits/budget and SQLite/JSON device snapshot
exchange; complete QuotaBar parity has not been verified. The parallel ccstats
change restores its existing CI and five-platform installer pipeline. Do not
remove or claim completion of those workflows before a verified handover.

## Install and release delivery

For current published installers, use [GitHub Releases](https://github.com/majiayu000/quotabar/releases).
For this checkout, run `npm ci`, `npm run build`, then `npm run tauri -- build` with
the platform Tauri prerequisites. Local builds are separate from signed release
artifacts. Provider login uses the existing CLI/provider setup; after signing in,
use the recovery action to check again.

These task branches have no newly published release. Publish the ccstats SDK
change first, refresh QuotaBar's lockfile, repeat the integration checks, then
prepare the normal version/changelog/artifact/signing review described in
[release.md](release.md). Failed source reads must remain visible through that
sequence. No real-user confirmation or Windows 10 result is claimed.

## Verification

- `npm test`: 675 passed across 62 files, including stale/expired login recovery, source failures, cost coverage, interface scaling and source evidence.
- `npm run build`, `npm run release:check`, and Rust formatting: passed.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 166 passed, 10 existing manual/ignored tests skipped; includes the explicit 2K geometry matrix.
- `node --test scripts/test_app_lifecycle.mjs`: 15 passed after allowing the test fixture 30 seconds to complete its child processes. The production installer timeout and rollback remain unchanged.
- Parallel ccstats checks: 1,049 Rust tests, Clippy, dependency checks, release metadata and package dry-run passed; desktop frontend build and 36 synthetic renderer end-to-end tests passed.
- ccstats desktop Rust: 15 passed. The QuotaBar Rust suite also passed with the local ccstats SDK override (166 passed, 10 existing manual/ignored tests skipped); its published dependency lockfile was restored afterward.
- ccstats desktop Clippy with `--all-targets -- -D warnings`: passed.
- Final Rust regression: 166 passed, 10 existing manual/ignored tests skipped. The targeted session/usage/alias fixture also passed against the modified local SDK; the published lockfile was restored and checked afterward.

The ccstats native IPC script was stopped during compilation before app launch:
it would drive desktop UI through WebDriver, which this task does not authorize.
Its build log is retained and no native UI result is claimed. Command logs and
snapshots remain under `/tmp/quotabar-ccstats-20261007/`.
Windows 10 native testing remains blocked at SSH host-key verification.

Git push lacked HTTPS credentials. Delivery uses the connected GitHub API and
compares each remote Git tree hash with the tested local commit before writing
the branch ref. Original checkout snapshot comparisons were both empty: task
changes are isolated in their worktrees.

### Installed data observation

A temporary Rust executable linked this task's ccstats SDK and called its actual
`usage_analysis_with_cli_config` for Today in offline mode. It reconciled summary,
session and daily token totals and checked every returned source path with the
filesystem, without printing paths or transcript content. Codex: 32 sessions,
57 contributing files, 487,730,985 tokens, 0 parse errors. Claude: no records in
Today, so this observation provides no non-empty Claude acceptance. This is a
local data observation, not Windows UI acceptance or subscription-bill verification.

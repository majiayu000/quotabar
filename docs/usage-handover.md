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

The provenance and additional native discovery diagnostics are supplied by
[ccstats 0.11.0](https://github.com/majiayu000/ccstats/releases/tag/v0.11.0).
This checkout resolves that published crate and agent-sessions 0.2.2 directly
from crates.io. Its package VCS record matches release commit 971a146; its checksum
matches the published Homebrew source. No local Cargo override is shipped.

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

## Repeatable Windows acceptance

[QuotaBar v0.7.4](https://github.com/majiayu000/quotabar/releases/tag/v0.7.4)
is the current public desktop reference. The #186 taskbar overflow repair shipped
in [v0.7.0](https://github.com/majiayu000/quotabar/releases/tag/v0.7.0) and has a
[Windows 11 dual-4K result](https://github.com/majiayu000/quotabar/issues/186#issuecomment-6638072260).
Windows 10 acceptance for [#186](https://github.com/majiayu000/quotabar/issues/186)
and the Claude title report [#215](https://github.com/majiayu000/quotabar/issues/215)
remain open.

Run the isolated regression cases from this directory:

```bash
npm ci
npm run test:handover
cargo test --locked --manifest-path src-tauri/Cargo.toml services::popover_layout::tests
cargo test --locked --manifest-path src-tauri/Cargo.toml real_sdk_report_retains_session_identity_titles_and_usage
```

The TypeScript tests exercise the renderer, saved interface sizing, quota
recovery and budget accounting. Rust uses deterministic display geometry and
an isolated native SDK fixture. For physical acceptance, use an installed build:

1. On Windows 10 with the original 27-inch 2560×1440 setup, use Settings →
   Display → Interface size at 100%, 125% and 150%. Compare text and controls in
   both windows, check scrolling and confirm that the setting survives restart.
   Repeat at the reported system DPI/text scaling. For mixed DPI, move the
   workspace between monitors and verify layout at the destination.
2. Open the tray from both a pinned icon and the `^` overflow flyout, then open
   it again after dismissing it. Check that the popover stays against the target
   monitor's taskbar, aligned to the clicked icon and inside the work area.
   Include the reporter's taskbar position and auto-hide setting.
3. In a separate Windows test profile, prepare a Claude source with a known
   title. The following fixture works offline and uses a temporary directory.
   Quit any running QuotaBar instance first. Point `$app` at the installed
   executable and run the block from PowerShell:

   ```powershell
   $app = 'C:\path\to\installed\QuotaBar.exe'
   $fixture = Join-Path ([IO.Path]::GetTempPath()) ('quotabar-handover-' + [guid]::NewGuid())
   $project = Join-Path $fixture 'projects\D--work----'
   New-Item -ItemType Directory -Path $project | Out-Null
   $session = 'windows-handover-fixture'
   $usage = @{
       type = 'assistant'; sessionId = $session; cwd = 'D:\work\中文项目'
       timestamp = [DateTime]::UtcNow.ToString('o')
       message = @{ id = 'handover-fixture-message'; model = 'claude-sonnet-4-20250514'; usage = @{ input_tokens = 30; output_tokens = 10 } }
   } | ConvertTo-Json -Depth 6 -Compress
   $title = @{ type = 'ai-title'; sessionId = $session; aiTitle = 'Windows 验收会话标题' } | ConvertTo-Json -Compress
   $log = Join-Path $project "$session.jsonl"
   [IO.File]::WriteAllLines($log, [string[]]@($usage, $title), [Text.UTF8Encoding]::new($false))
   $previous = $env:CLAUDE_CONFIG_DIR
   try {
       $env:CLAUDE_CONFIG_DIR = $fixture
       Start-Process -FilePath $app -Wait
   } finally {
       $env:CLAUDE_CONFIG_DIR = $previous
   }
   ```

   Open Claude usage in the dashboard and select a date range including today.
   In the session list and details, confirm the same title and 40 tokens. Expand
   Original usage sources and confirm the file named by `$log`. Apply and clear
   the project filter and verify that the title stays attached to this session.

Record the build, Windows version, viewport/DPI/text scale, taskbar state and
result for each issue. Use the [ccstats handover checklist](https://github.com/majiayu000/ccstats/blob/main/docs/desktop-handover.md#repeatable-handover-checks)
for the retained workflows and desktop retirement decision.

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

The ccstats SDK and its retained five-platform desktop installers are published
at 0.11.0. QuotaBar 0.6.0 is prepared with the registry SDK, matching manifests
and a regression that requires the actual contributing Codex file after filtering.
Its own public release still requires the candidate/signing approval in
[release.md](release.md). Failed source reads remain visible through that
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

## Follow-up — 2026-10-08

QuotaBar #211 and ccstats #207 are merged. ccstats final-head CI and its full
0.11.0 release workflow succeeded, including both hosted native IPC tests,
five CLI archives, five desktop installers, macOS signing/notarization and the
Homebrew update. The release has 20 files including checksum sidecars; the
downloaded Apple Silicon CLI archive matches the public release digest and runs
as 0.11.0. These results do not establish physical Windows 10 display acceptance.

Fresh QuotaBar checks use the production registry dependency: 166 Rust tests
passed (10 existing manual/ignored), including session identity, exact native
source location, filters and SDK aliases. Frontend: 675 tests passed. Build,
Rust formatting, release-version checks and 15 lifecycle tests passed.
An additional Clippy check reported seven warnings in unchanged tray/Cursor/Grok
code; it is not a required CI check and no unrelated cleanup is included.

Tailscale SSH was retried through the same access path and timed out after 15
seconds. No remote command, host-trust change or alternate access method was used.
Physical Windows 10/27-inch 2K, system text scaling, mixed-DPI display testing and
complete desktop workflow parity remain unverified. Desktop workflows stay available.

A fresh temporary consumer of the published registry SDK reconciled this week's
summary, session and daily token totals: 51 priced Codex sessions, 120 contributing
files, 2,454,566,858 tokens and 0 parse errors. Every source file exists; no paths
or transcript content were printed. Claude had no records in this range, so no
non-empty Claude acceptance is claimed.

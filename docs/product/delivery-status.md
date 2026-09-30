# Usage product delivery status — 2026-09-30

This records PR #190's source changes after reconciliation with current `main`.
Windows build/test CI and native UI acceptance are separate evidence.

## Implementation

- agent-sessions owns native parsing/provenance, ccstats owns accounting,
  pricing and CLI/SDK contracts, and QuotaBar owns tray/desktop analysis,
  notifications and settings. ccstats desktop retirement still requires a
  verified handover of its diagnostics, investigation and device workflows.
- Adopt published ccstats 0.9.1 and lock agent-sessions 0.2.1 from crates.io.
  Existing SDK-versioned caches invalidate older cost snapshots. Retain
  current main's automatic public price refresh.
- Retain the released 100%/125%/150% Interface size control from PR #194/v0.5.6.
  Remove PR #190's superseded text-only control. Both windows share the saved
  size; native work-area clamping and clipped-content measurement remain.
- Put installer/first-run guidance ahead of developer setup, distinguish
  Antigravity availability from quota support, and use QuotaBar page branding.
- Run frontend, production build and locked Rust checks in CI on macOS and
  Windows. Source-fixture tests normalize CRLF before applying LF mutations;
  the coverage-path test uses the host platform's path resolution.

## Verification in this maintenance session

- Frontend: 620 tests passed; TypeScript and production asset build passed.
- CRLF reproduction: 23 test failures and one suite load failure before the
  correction; all 110 affected tests passed afterward with CRLF source files.
- Release manifests agree on 0.5.8. No release or installed-app update is
  performed by this PR.
- Rust and exact-head remote CI results are recorded in the PR description
  after their checks finish.

## Remaining delivery gates

1. The [maintainer's #186 comment](https://github.com/majiayu000/quotabar/issues/186#issuecomment-5890254980)
   reports Windows 11/4K/150% acceptance for v0.5.6. The original Windows 10 /
   27-inch 2K environment still needs reporter confirmation; this macOS CLI
   session performs no Windows native UI test. Keep #186 open.
2. Verify ccstats desktop workflow parity before retiring any feature. No data
   migration or desktop removal is part of this PR.
3. Refresh the public demo using a current native build and curated data. The
   existing README screenshot remains labeled v0.4.0 browser preview.
4. Review and merge the source change, then follow normal release verification.
   Repository edits do not update the installed application.
5. External first-run/retention and paid-use validation remain product work.
   No telemetry or paid service is added.

Antigravity quota support remains pending independently.

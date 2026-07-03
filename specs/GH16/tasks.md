# GH-16 Tasks

## Implementation Tasks

- [x] `UI16-T1` Owner: codex. Done when: GitHub issue #16 and this SpecRail packet define the shell/overview scope. Verify: `find specs/GH16 -maxdepth 1 -type f -print`.
- [ ] `UI16-T2` Owner: codex. Done when: app shell uses redesign glass surface tokens without a solid rectangular backing. Verify: visual screenshot plus `rg -n "glass|backdrop-filter|provider-overview|overview" src`.
- [ ] `UI16-T3` Owner: codex. Done when: tab state supports `overview` and concrete provider tabs without breaking tray activation. Verify: `npx tsc --noEmit` and targeted tests if helpers are extracted.
- [ ] `UI16-T4` Owner: codex. Done when: provider summary tiles render real connected/loading/offline/no-data states for all services. Verify: browser preview with no Tauri backend and at least one connected-provider manual check.
- [ ] `UI16-T5` Owner: codex. Done when: overview most-constrained rows are derived from real data only and sorted by used percentage. Verify: unit tests for sorting/no-data behavior if helper is extracted.
- [ ] `UI16-T6` Owner: codex. Done when: project verification passes. Verify: `npx tsc --noEmit && npm test && npm run build`.

## Handoff Notes

This should be the first implementation PR in the UI redesign stack. Do not merge it into PR #15. If PR #15 is still open, keep this branch based on `main` and record that GH-17 has the reset-credit dependency.

# GH-18 Tasks

## Implementation Tasks

- [x] `UI18-T1` Owner: codex. Done when: GitHub issue #18 and this SpecRail packet define settings/footer scope. Verify: `find specs/GH18 -maxdepth 1 -type f -print`.
- [ ] `UI18-T2` Owner: codex. Done when: settings view or compact panel preserves theme, Hide Dock, and current storage keys. Verify: `npx tsc --noEmit` and manual persistence check.
- [ ] `UI18-T3` Owner: codex. Done when: tray toggles preserve per-service enablement and final-tray guard. Verify: targeted tests if helper logic changes, plus manual guard check.
- [ ] `UI18-T4` Owner: codex. Done when: footer actions match active-provider behavior and loading states. Verify: manual active-tab refresh/dashboard checks.
- [ ] `UI18-T5` Owner: codex. Done when: unsupported future settings are not shipped as working controls. Verify: PR review against visible controls.
- [ ] `UI18-T6` Owner: codex. Done when: project verification passes. Verify: `npx tsc --noEmit && npm test && npm run build`.

## Handoff Notes

GH-18 should not run as a parallel writable implementation with GH-17 because both touch `App.tsx` and `styles.css`. Use a stacked PR or wait for the earlier UI implementation branch to stabilize.

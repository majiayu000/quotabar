# GH-17 Tasks

## Implementation Tasks

- [x] `UI17-T1` Owner: codex. Done when: GitHub issue #17 and this SpecRail packet define detail panel scope and PR #15 dependency. Verify: `find specs/GH17 -maxdepth 1 -type f -print`.
- [ ] `UI17-T2` Owner: codex. Done when: implementation base decision is recorded: updated `main` after PR #15 merge, stacked on PR #15, or Bonus resets deferred with explicit follow-up. Verify: PR body includes the decision.
- [ ] `UI17-T3` Owner: codex. Done when: provider detail panels share redesign row/card structure without losing provider-specific data semantics. Verify: `npx tsc --noEmit`.
- [ ] `UI17-T4` Owner: codex. Done when: Codex Bonus resets preserves PR #15 reset credits and does not mix them with generic Codex credits. Verify: targeted frontend tests or screenshot/fixture evidence.
- [ ] `UI17-T5` Owner: codex. Done when: upcoming resets and smart tips use real data only and omit missing/unsupported data. Verify: unit tests for helper functions if extracted.
- [ ] `UI17-T6` Owner: codex. Done when: local cost redesign preserves loading/error/cached/refresh semantics. Verify: `npm test`.
- [ ] `UI17-T7` Owner: codex. Done when: project verification passes. Verify: `npx tsc --noEmit && npm test && npm run build`.

## Handoff Notes

This is likely the highest-conflict UI PR because it touches panels and `src/styles.css`. Do not run it in parallel with GH-18 writable work unless file ownership is split or one branch is stacked after the other.

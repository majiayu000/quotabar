# GH-61 Tasks：switcher visibility transaction

## Delivery Contract

- Base: spec 与 implementation PR 分别基于创建时 then-latest `origin/main`。
- Commit policy: `per_step`。
- Scope: 仅修 switcher visibility transition 的 guard observability 与 persistence cardinality。
- Compatibility: SettingsView/storage schema、active-tab fallback、tray/backend/provider/dependencies 不变。

## Implementation Tasks

- [ ] `SP61-T1` Owner: codex. Dependencies: merged spec. Covers: `B-001`~`B-006`. Done when: `handleSwitcherToggle` 从 current render snapshot 同步决定 terminal；blocked 零 state/save 且 fixed toast/timer once；accepted exact next state/save once；functional updater 无 side effect。 Verify: targeted real-App tests。
- [ ] `SP61-T2` Owner: codex. Dependencies: T1. Covers: `B-001`~`B-006`. Done when: StrictMode real App/SettingsView callback、四 service blocked matrix、accepted enable/disable、peer preservation、exact saver、toast lifecycle 与 Overview fallback deterministic 通过；无 copied helper/wall-clock/DOM dependency。 Verify: `tests/switcher_visibility_transactions.test.tsx`。
- [ ] `SP61-T3` Owner: codex. Dependencies: T1-T2. Covers: `B-007`. Done when: exact 3-path allowlist；overall executable diff ≥80%；`src/App.tsx` critical changed lines 100%；full frontend/build/Rust pass。 Verify: tech Test Plan。

## Handoff

- [ ] `SP61-T4` Owner: codex. Dependencies: T3. Done when: implementation PR `Closes #61`，正文记录 reproduction、transaction boundary、StrictMode cardinality、test matrix、coverage、dependency boundary 与 rollback，并通过 implementation-vs-spec、current-head connector/CI/reviewThreads gate。

## Handoff Notes

- Invariants: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007}`。
- Coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007}`。
- Spec PR 仅三份 GH61 文档；implementation 才修改 App、tests 与本 tasks ledger。
- 禁止 force push、functional-updater side effect、duplicate persistence、silent blocked terminal、test weakening 或 allowlist 外 scope。

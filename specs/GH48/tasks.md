# GH-48 Tasks：通知 delivery-first dedupe

## Delivery Contract

- Base: spec 与 implementation PR 分别基于创建时 then-latest `origin/main`。
- Commit policy: `per_step`。
- Scope: 只修 notification eligibility/commit/concurrency/outcome/caller visibility。
- Compatibility: storage JSON、12-hour window、settings、threshold/body 不变。

## Implementation Tasks

- [x] `SP48-T1` Owner: codex. Dependencies: merged spec. Covers: `B-001`, `B-003`. Done when: eligibility read-only；success 后 prune+commit；existing settings/dedupe window/different-body semantics exact。 Verify: notifications + storage read tests。
- [x] `SP48-T2` Owner: codex. Dependencies: T1. Covers: `B-002`, `B-006`. Done when: typed sent/skipped/failure；denial、permission/plugin/send/read failure 不 commit且 retry；fixed safe message + on_failure exactly once。 Verify: delivery failure matrix。
- [x] `SP48-T3` Owner: codex. Dependencies: T1-T2. Covers: `B-003`, `B-004`, `B-005`. Done when: same-body concurrency one send；different-body concurrent success 使用 commit-time fresh read/merge，storage 同含 A/B 且随后两者 duplicate；finally release；post-send fresh-read/write failure 均 sent + session-deduped；notification write failure console 仅固定字符串、零原始 Error argument。 Verify: deferred concurrency、A/B lost-update、throwing read/write storage tests。
- [x] `SP48-T4` Owner: codex. Dependencies: T2. Covers: `B-006`. Done when: service 80%/95% 与 bonus 三个 callsites 的第三参数均为 tested failure-options helper；callback 只写 fixed critical event、零 recursive notify；原事件顺序不变。 Verify: TypeScript AST exact-callsite/helper gate + outcome callback tests。
- [ ] `SP48-T5` Owner: codex. Dependencies: T1-T4. Covers: `B-001`~`B-006`. Done when: 9-path allowlist、checker 100%、overall diff ≥80%、notifications critical diff 100%、full frontend/build/Rust pass。 Verify: tech Test Plan。

## Handoff

- [ ] `SP48-T6` Owner: codex. Dependencies: T5. Done when: implementation PR `Closes #48`，正文记录 root cause/state machine/failure semantics/concurrency/coverage/rollback，并通过 implementation-vs-spec、current-head connector/CI/reviewThreads gate。

## Handoff Notes

- Invariants: `{B-001, B-002, B-003, B-004, B-005, B-006}`。
- Coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006}`。
- Spec PR 与本 amendment 仅三份 GH48 文档；implementation 才修改 9-path allowlist 文件。
- 禁止 force push、pre-send commit、silent catch、error text leak、test weakening 或范围扩张。

# GH-55 Tasks：popover visibility fail-closed lifecycle

## Delivery Contract

- Base: spec 与 implementation PR 分别基于创建时 then-latest `origin/main`。
- Commit policy: `per_step`。
- Scope: 仅修 visibility read/focus subscription 的 failure、ordering 与 cleanup ownership。
- Compatibility: public hook signature、browser behavior、resize、provider/cost cadence、backend/UI/dependencies 不变。

## Implementation Tasks

- [ ] `SP55-T1` Owner: codex. Dependencies: merged spec. Covers: `B-001`~`B-007`. Done when: effect-owned mounted/focus precedence/listener ownership state machine 接入真实 hook；read/subscription throw/reject 使用固定安全 error 并 fail closed；cleanup terminal 零副作用。 Verify: targeted real-hook lifecycle tests。
- [ ] `SP55-T2` Owner: codex. Dependencies: T1. Covers: `B-001`~`B-007`. Done when: browser、initial、focus、failure、ordering、cleanup 与 safe-log deterministic matrix 全部通过；normal/late unlisten counts exact；无 wall-clock sleep。 Verify: `tests/popover_window_visibility.test.tsx`。
- [ ] `SP55-T3` Owner: codex. Dependencies: T1-T2. Covers: `B-008`. Done when: exact 3-path allowlist；renderer dev-only exact version；overall executable diff ≥80%；hook critical diff 100%；full frontend/build/Rust pass。 Verify: tech Test Plan。

## Handoff

- [ ] `SP55-T4` Owner: codex. Dependencies: T3. Done when: implementation PR `Closes #55`，正文记录 reproduction、state/ordering model、safe errors、cleanup ownership、coverage、dependency boundary 与 rollback，并通过 implementation-vs-spec、current-head connector/CI/reviewThreads gate。

## Handoff Notes

- Invariants: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007, B-008}`。
- Coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007, B-008}`。
- Spec PR 仅三份 GH55 文档；implementation 才修改 hook、tests 与本 tasks ledger。
- 禁止 force push、raw error leakage、silent visible fallback、post-cleanup state write、test weakening 或 allowlist 外 scope。

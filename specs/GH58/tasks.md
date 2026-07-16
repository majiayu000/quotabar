# GH-58 Tasks：safe fatal frontend reporting

## Delivery Contract

- Base: spec 与 implementation PR 分别基于创建时 then-latest `origin/main`。
- Commit policy: `per_step`。
- Scope: 仅修入口 fatal diagnostics 的 raw-data boundary、single-surface ownership 与 reporter failure observability。
- Compatibility: React root、App render、window listeners、backend/Tauri/provider/storage/dependencies 不变。

## Implementation Tasks

- [x] `SP58-T1` Owner: codex. Dependencies: merged spec. Covers: `B-001`~`B-007`. Done when: closed source union、fixed safe primary/secondary strings、global preventDefault exact-once、argument-discarding React callback、fixed-ID single surface 与 observable DOM failure 接入真实 entry module；零 raw access/coercion/log/DOM/default report。 Verify: targeted real-entry tests。
- [x] `SP58-T2` Owner: codex. Dependencies: T1. Covers: `B-001`~`B-007`. Done when: wiring、三 channel、global preventDefault、throwing error/message/reason getters与toString、first/existing/repeated ownership、六类 DOM failure 与 innerHTML runtime trap deterministic matrix 全部通过；无 wall-clock/jsdom/copied helper。 Verify: `tests/fatal_error_reporting.test.tsx`。
- [x] `SP58-T3` Owner: codex. Dependencies: T1-T2. Covers: `B-008`. Done when: exact 3-path allowlist；overall executable diff ≥80%；`src/main.tsx` critical changed lines 100%；full frontend/build/Rust pass。 Verify: tech Test Plan。

## Handoff

- [x] `SP58-T4` Owner: codex. Dependencies: T3. Done when: implementation PR `Closes #58`，正文记录 reproduction、threat boundary、fixed diagnostics、single-surface ownership、DOM terminal matrix、coverage、dependency boundary 与 rollback，并通过 implementation-vs-spec、current-head connector/CI/reviewThreads gate。

## Handoff Notes

- Invariants: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007, B-008}`。
- Coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007, B-008}`。
- Spec PR 仅三份 GH58 文档；implementation 才修改 entry、tests 与本 tasks ledger。
- 禁止 force push、raw fatal payload exposure、empty catch、innerHTML、duplicate fatal surface、test weakening 或 allowlist 外 scope。

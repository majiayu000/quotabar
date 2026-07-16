# GH-52 Tasks：provider refresh latest-wins

## Delivery Contract

- Base: spec 与 implementation PR 分别基于创建时 then-latest `origin/main`。
- Commit policy: `per_step`。
- Scope: 仅修 async read completion ordering、cleanup invalidation 与 Antigravity interval 0 consistency。
- Compatibility: backend/payload/refresh cadence/UI/cache 不变；零 runtime dependency。

## Implementation Tasks

- [x] `SP52-T1` Owner: codex. Dependencies: merged spec. Covers: `B-001`, `B-003`, `B-004`. Done when: stable monotonic generation hook、unmount invalidate、current success/failure/finally contract、critical 100%。 Verify: latest-request unit/hook tests。
- [x] `SP52-T2` Owner: codex. Dependencies: T1. Covers: `B-001`~`B-006`. Done when: Claude/Codex/Cursor/Antigravity 全部接入 owner-shared guard；Codex bundle atomic；每个 owner 的 success/failure/finally/unmount parameterized matrix 通过；三 bundle members current/stale rejection 通过；Antigravity interval 0 pauses；fail-closed wiring checker 拒绝所有 adversarial fixtures。 Verify: provider deferred real-effect matrix + wiring checker 100%。
- [x] `SP52-T3` Owner: codex. Dependencies: T1. Covers: `B-001`~`B-005`. Done when: Cost overview/daily 独立 generations；两 lane 的 success/failure/cleanup full matrix 通过；overview stale finally 与 cross-lane identity exact。 Verify: cost parameterized deferred tests。
- [x] `SP52-T4` Owner: codex. Dependencies: T1-T3. Covers: `B-007`. Done when: dev-only renderer 与 resolved React exact version；13-path allowlist；overall diff ≥80%；wiring checker、coordinator 与五个 owner 新增 stale terminal paths critical 100%；full frontend/build/Rust pass。 Verify: tech Test Plan。

## Handoff

- [x] `SP52-T5` Owner: codex. Dependencies: T4. Done when: implementation PR `Closes #52`，正文记录 reproduction、lane model、stale terminal semantics、dependency boundary、coverage、rollback，并通过 implementation-vs-spec、current-head connector/CI/reviewThreads gate。

## Handoff Notes

- Invariants: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007}`。
- Coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007}`。
- Spec PR 仅三份 GH52 文档；implementation 才修改 13-path allowlist 文件。
- 禁止 force push、stale commit、current failure swallowing、test weakening、runtime dependency 或 tray write scope expansion。

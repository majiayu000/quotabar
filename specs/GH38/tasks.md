# GH-38 Tasks：显式处理 storage read failure

## Delivery Contract

- Base: spec PR 与 implementation PR 均从各自创建时最新 `origin/main` 派生。
- Commit policy: `per_step`。
- Backward compatibility: 有效 storage keys/格式/default、GH35 write shadow required；损坏数据的静默部分接受 not required。
- Scope exclusion: backend migration、App/CSS split、非 storage 空 catch、pricing/cost 与其他优化。

## Implementation Tasks

- [x] `SP38-T1` Owner: codex. Dependencies: merged GH38 spec PR. Covers: `B-001`~`B-004`, `B-007`. Done when: storage adapter 用 `StorageReadResult<T>`、strict decoder、显式 `notifyUser`、safe access/decode error、独立 read subscriber 与 pending boolean 替换 raw reader；missing/value/failure、shadow-first、active/unsubscribe/listener-error、startup coalescing 单测通过；不保留 `readStorageItem` alias。 Verify: `npx vitest run tests/storage_read_failures.test.ts tests/storage_write_failures.test.ts`.
- [x] `SP38-T2` Owner: codex. Dependencies: `SP38-T1`. Covers: `B-001`~`B-003`, `B-006`, `B-007`. Done when: app_state、budget、notification settings、panel、switcher、tray style/cycle/visibility、event log 全部使用 typed reader 与 strict decoder；13 public entrypoints 的 success/missing/access/malformed 矩阵通过；user-visible failure 通知、missing 零通知、event mixed-invalid 整项失败均有证据；switcher all-false 判为 schema failure，固定 error + listener once 后返回现有 all-visible default；`tests/budget.test.ts` 的旧 partial-accept 断言改为验证 known-field schema failure 整项拒绝，合法 round-trip/预算求和断言保持。 Verify: `npx vitest run tests/storage_read_failures.test.ts tests/budget.test.ts tests/event_log.test.ts tests/notifications.test.ts tests/panel_sections.test.ts tests/switcher_providers.test.ts tests/tray_style.test.ts tests/tray_visibility.test.ts`.
- [x] `SP38-T3` Owner: codex. Dependencies: `SP38-T1`, `SP38-T2`. Covers: `B-003`, `B-004`. Done when: App 导出并实际使用可运行时测试的 `subscribeStorageReadFailureToast(setToast, schedule?)` helper；effect 精确 `return subscribeStorageReadFailureToast(setToast);`；多个 initializer failure 只交付一次准确 `STORAGE_READ_FAILURE_MESSAGE`，注入 scheduler 清除 toast，unsubscribe 后后续 failure 不调用；禁止以 SSR render 或仅搜索符号代替运行时证据。 Verify: `npm run build && rg -q 'return subscribeStorageReadFailureToast\(setToast\);' src/App.tsx && npx vitest run tests/storage_read_failures.test.ts`.
- [x] `SP38-T4` Owner: codex. Dependencies: `SP38-T2`. Covers: `B-005`, `B-006`. Done when: dedupe access/JSON/schema failure 均 `shouldNotify === false`、setItem 0、read listener 0，恢复后可成功一次；event access/malformed 返回 `[]`、error + read listener once。 Verify: `npx vitest run tests/storage_read_failures.test.ts tests/notifications.test.ts tests/event_log.test.ts`.
- [x] `SP38-T5` Owner: codex. Dependencies: `SP38-T1`~`SP38-T4`. Covers: `B-002`, `B-007`. Done when: `readStorageItem` 在 src/tests 零结果，`localStorage.getItem` 仅 adapter；implementation diff 只含 14-path allowlist；GH35 write suite 全绿；新增 TS/TSX diff executable lines ≥80%，storage/notifications/event_log 新增行各 100%，checker 自身既有 100% gate 通过。 Verify: 执行 tech spec 完整 Test Plan 的 static、Node coverage、Vitest LCOV 与 diff checker 部分。

## Verification Tasks

- [x] `SP38-T6` Owner: codex. Dependencies: `SP38-T1`~`SP38-T5`. Covers: `B-001`~`B-007`. Done when: 最终 implementation HEAD 上完整 `npm test`、build、Rust fmt/check/test 新鲜通过。 Verify: `npm test && npm run build && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`.
- [x] `SP38-T7` Owner: codex. Dependencies: `SP38-T6`. Covers: none（handoff）. Done when: implementation PR 以 `Closes #38` 链接 issue，正文写明原因、三态、startup pending、dedupe safety、风险、coverage、rollback 与验证证据，并接受 implementation-vs-spec review、current-head connector/CI/reviewThreads gate。 Verify: `gh pr view --json body,headRefOid,statusCheckRollup,mergeStateStatus,url`.

## Handoff Notes

- Product invariant set: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007}`.
- Task coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006, B-007}`.
- Spec PR 只提交本目录三份文档；implementation PR 才修改代码、测试并勾选 tasks。
- 用户已提供持续 issue/PR/CI fix/merge 授权；仍禁止 force push、弱化测试、泄漏 storage value 或扩大 scope。

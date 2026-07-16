# GH-35 Tasks：显式处理 localStorage 写入失败

## Delivery Contract

- Base: spec PR 与 implementation PR 均从各自创建时最新的 `origin/main` 派生。
- Commit policy: `per_step`。
- Backward compatibility: storage keys、格式与成功路径 required；内部 saver `void` 签名 not required。
- Scope exclusion: localStorage 读取失败/default 策略、其他空 `catch`、持久化后端迁移、PR #31 与其他优化项。

## Implementation Tasks

- [ ] `SP35-T1` Owner: codex. Dependencies: merged GH-35 spec PR. Covers: `B-001`, `B-002`, `B-005`, `B-006`. Done when: `storage.ts` adapter、固定失败文案、session shadow、`reportStorageWriteResult`、成功/抛错/恢复成功单测与 coverage 依赖已加入；异常路径不记录 key/value、返回 `false`，后续成功写入清除旧 shadow。 Verify: `npx vitest run tests/storage_write_failures.test.ts`.
- [ ] `SP35-T2` Owner: codex. Dependencies: `SP35-T1`. Covers: `B-001`, `B-002`, `B-005`, `B-006`. Done when: budget、notification settings、panel sections、switcher、tray cycle/style/visibility saver 全部返回 adapter boolean，现有 getters 通过 adapter 读取 session shadow 且保留原 catch/default；throwing-storage 矩阵覆盖所有入口，并证明 budget/tab reread 保持失败写入的新值。 Verify: `npx vitest run tests/storage_write_failures.test.ts tests/budget.test.ts tests/notifications.test.ts tests/panel_sections.test.ts tests/switcher_providers.test.ts tests/tray_style.test.ts`.
- [ ] `SP35-T3` Owner: codex. Dependencies: `SP35-T2`. Covers: `B-002`, `B-005`. Done when: App 的 tab/theme/dock/settings 写入和所有用户 setting saver 调用都通过 `reportStorageWriteResult` 检查失败并显示统一 toast；SettingsView budget 失败通过 callback 显示同一提示；`app_state.ts` 初始化修复写入显式检查失败。 Verify: `npm run build && rg -q "STORAGE_WRITE_FAILURE_MESSAGE" src/App.tsx && rg -q "showStorageWriteFailure" src/App.tsx && rg -q "reportStorageWriteResult" src/App.tsx && rg -q "onStorageWriteFailure" src/App.tsx && rg -q "onStorageWriteFailure" src/components/SettingsView.tsx && rg -q "reportStorageWriteResult" src/components/SettingsView.tsx && rg -q "if \\(!saveTrayEnabled\\('claude', true\\)\\)" src/services/app_state.ts`.
- [ ] `SP35-T4` Owner: codex. Dependencies: `SP35-T1`, `SP35-T2`. Covers: `B-003`, `B-004`. Done when: dedupe 写失败时 `shouldNotify` 返回 `false`；event log 写失败仍返回并可读回本会话事件，且 adapter 产生 error 级证据。 Verify: `npx vitest run tests/storage_write_failures.test.ts tests/notifications.test.ts tests/event_log.test.ts`.
- [ ] `SP35-T5` Owner: codex. Dependencies: `SP35-T2`, `SP35-T3`, `SP35-T4`. Covers: `B-005`, `B-006`. Done when: `src/` 的 `localStorage.setItem` 只存在于 adapter，implementation diff 仅包含 GH35 allowlist；LCOV diff checker 有独立 unit tests 且 checker 本身 100% lines/functions/branches，全部新增 TS/TSX 可执行行 ≥80%，storage/notifications/event_log 新增行分别 100%；缺 base、LCOV、可计量行、解析、搜索或额外文件均 fail closed。 Verify: `git fetch origin main:refs/remotes/origin/main && matches=$(rg -l "localStorage\\.setItem" src) && test "$matches" = "src/services/storage.ts" && node --experimental-test-coverage --test-coverage-include=scripts/check_ts_diff_coverage.mjs --test-coverage-lines=100 --test-coverage-functions=100 --test-coverage-branches=100 --test scripts/check_ts_diff_coverage.test.mjs && npx vitest run --coverage --coverage.include='src/**/*.{ts,tsx}' --coverage.reporter=lcov --coverage.reporter=text && node scripts/check_ts_diff_coverage.mjs --base origin/main --lcov coverage/lcov.info --minimum 80 --critical src/services/storage.ts=100 --critical src/services/notifications.ts=100 --critical src/services/event_log.ts=100 && git diff --quiet origin/main...HEAD -- . ':(exclude)package.json' ':(exclude)package-lock.json' ':(exclude)scripts/check_ts_diff_coverage.mjs' ':(exclude)scripts/check_ts_diff_coverage.test.mjs' ':(exclude)src/services/storage.ts' ':(exclude)src/services/app_state.ts' ':(exclude)src/services/budget.ts' ':(exclude)src/services/event_log.ts' ':(exclude)src/services/notifications.ts' ':(exclude)src/services/panel_sections.ts' ':(exclude)src/services/switcher_providers.ts' ':(exclude)src/services/tray_style.ts' ':(exclude)src/services/tray_visibility.ts' ':(exclude)src/App.tsx' ':(exclude)src/components/SettingsView.tsx' ':(exclude)tests/storage_write_failures.test.ts' ':(exclude)specs/GH35/tasks.md'`.

## Verification Tasks

- [ ] `SP35-T6` Owner: codex. Dependencies: `SP35-T1`~`SP35-T5`. Covers: `B-001`, `B-006`. Done when: 完整前端与 Rust 验证在 implementation branch 最终 HEAD 上新鲜通过。 Verify: `npm test && npm run build && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] `SP35-T7` Owner: codex. Dependencies: `SP35-T6`. Covers: none（PR handoff housekeeping）. Done when: implementation PR 以 `Closes #35` 链接 issue，列出失败语义、风险、rollback、coverage 和全量验证证据，并接受 SpecRail 对照与最终 PR gate。 Verify: `gh pr view --json body,statusCheckRollup,reviewDecision,mergeStateStatus,url`.

## Handoff Notes

- Product invariant set: `{B-001, B-002, B-003, B-004, B-005, B-006}`.
- Task coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006}`.
- Spec PR 只提交本目录三份文档；implementation PR 才修改代码、依赖、测试并勾选任务。
- 用户已为持续优化提供 issue、PR、CI 修复与 merge 的明确授权；仍不得 force push、跳过失败验证或扩大到 issue 非目标。

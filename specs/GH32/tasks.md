# GH-32 Tasks：移除未使用的 Codex stats 命令链路

## Delivery Contract

- Base: spec PR 与 implementation PR 均从各自创建时最新的 `origin/main` 派生。
- Commit policy: `per_step`。
- Backward compatibility: 用户可见行为 required；未消费内部 command not required。
- Scope exclusion: `src-tauri/src/services/cost.rs`、`src-tauri/src/services/codex_pricing.rs`、`specs/GH10/*` 与其他优化项。

## Implementation Tasks

- [ ] `SP32-T1` Owner: codex. Dependencies: merged GH-32 spec PR. Covers: `B-001`, `B-002`. Done when: `CodexStats` TypeScript 类型和 `backend.getCodexStats()` wrapper 已删除，其他 backend 方法保持原契约。 Verify: `! rg -n "getCodexStats|CodexStats" src tests && npm run build`.
- [ ] `SP32-T2` Owner: codex. Dependencies: `SP32-T1`. Covers: `B-001`, `B-002`, `B-003`. Done when: Rust `CodexStats` model、`get_codex_stats` command/handler、`fetch_codex_stats()`、`HistoryStatsCache`、JSONL stats helpers 和专属 imports 已删除，其他 Codex APIs 未改语义。 Verify: `! rg -n "get_codex_stats|CodexStats|HistoryStatsCache|HISTORY_STATS_CACHE|history_stats_cache|update_stats_from_reader|build_codex_stats|fetch_codex_stats|history\\.jsonl" src-tauri/src && cargo check --manifest-path src-tauri/Cargo.toml`.
- [ ] `SP32-T3` Owner: codex. Dependencies: `SP32-T1`, `SP32-T2`. Covers: `B-002`, `B-004`. Done when: 全仓目标标识符负向检查无结果，且 implementation diff 仅包含 GH32 七个 allowlist 路径。 Verify: `! rg -n "getCodexStats|get_codex_stats|CodexStats|HistoryStatsCache|HISTORY_STATS_CACHE|history_stats_cache|update_stats_from_reader|build_codex_stats|fetch_codex_stats|history\\.jsonl" src src-tauri/src tests && ! git diff --name-only origin/main...HEAD | rg -v '^(src/types/models\.ts|src/services/backend\.ts|src-tauri/src/domain/models\.rs|src-tauri/src/commands\.rs|src-tauri/src/lib\.rs|src-tauri/src/services/codex\.rs|specs/GH32/tasks\.md)$'`.

## Verification Tasks

- [ ] `SP32-T4` Owner: codex. Dependencies: `SP32-T1`, `SP32-T2`, `SP32-T3`. Covers: `B-001`, `B-003`, `B-004`. Done when: 完整前端与 Rust 验证在 implementation branch 的最终 HEAD 上新鲜通过。 Verify: `npm test && npm run build && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] `SP32-T5` Owner: codex. Dependencies: `SP32-T4`. Covers: none（PR handoff housekeeping，不实现新的行为 invariant）. Done when: implementation PR 链接 issue #32、列出删除原因、风险、完整验证证据并接受 SpecRail 对照与 PR gate。 Verify: `gh pr view --json body,statusCheckRollup,reviewDecision,mergeStateStatus,url`.

## Handoff Notes

- Product invariant set: `{B-001, B-002, B-003, B-004}`.
- Task coverage union: `{B-001, B-002, B-003, B-004}`.
- Spec PR 只提交本目录三份文档；implementation PR 才修改生产代码并勾选任务。
- 用户已为本轮持续优化提供 issue、PR、CI 修复与 merge 的明确授权；仍不得 force push、跳过失败验证或扩大到 issue 非目标。

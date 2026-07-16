# GH-32 Tech Spec：移除未使用的 Codex stats 命令链路

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/32
- Product spec: `specs/GH32/product.md`

## Current Behavior

仓库存在一条没有消费者的跨栈链路：TypeScript 定义类型和 backend wrapper，Tauri 注册 command，Rust domain 定义响应类型，Codex service 读取并增量扫描 `~/.codex/history.jsonl`。全仓搜索没有组件、hook、service 或测试调用 `backend.getCodexStats()`。

## Codebase Context

| 当前锚点 | 当前职责 | 设计决定 |
| --- | --- | --- |
| `src/types/models.ts:28` | `CodexStats` TypeScript 响应类型 | 删除；没有消费者。 |
| `src/services/backend.ts:40` | `backend.getCodexStats()` invoke wrapper | 删除；不保留 alias 或 shim。 |
| `src-tauri/src/domain/models.rs:90` | `CodexStats` Rust model 与全零 `empty()` | 删除；避免未来把失败回退误当真实数据。 |
| `src-tauri/src/commands.rs:21` | `get_codex_stats` Tauri command | 删除 declaration 与 import。 |
| `src-tauri/src/lib.rs:40` | command handler registry | 删除 `commands::get_codex_stats` 注册项。 |
| `src-tauri/src/services/codex.rs:15` | `HistoryStatsCache` 与全局缓存 | 删除仅服务死能力的缓存状态。 |
| `src-tauri/src/services/codex.rs:107` | JSONL reader | 删除仅服务死能力的读取函数。 |
| `src-tauri/src/services/codex.rs:132` | stats builder | 删除仅服务死能力的转换函数。 |
| `src-tauri/src/services/codex.rs:194` | `fetch_codex_stats()` 与增量文件扫描 | 整段删除，并清理仅由它使用的 imports。 |

## Proposed Design

这是删除式变更，不新增替代路径：

1. 从 TypeScript contract 和 backend facade 删除 stats 类型与方法。
2. 从 Tauri command layer 删除 stats command 及 handler 注册。
3. 从 Rust domain/service 删除 stats model、历史扫描、缓存和专属 imports。
4. 保持 `get_codex_info`、`get_codex_rate_limits`、`get_codex_reset_credits` 及其他 command 顺序和行为不变。
5. 用 `rg` 负向检查证明没有跨层残留，再运行完整前端与 Rust 验证。

## Compatibility

- 用户可见行为：required，必须保持。
- 未文档化且未被仓库消费的内部 `get_codex_stats` command：backward compatibility not required。
- 不添加 alias、deprecated wrapper 或全零 fallback；这些都会继续扩大无效 API 面积。
- 无数据迁移、配置迁移或持久化格式变更。

## Risks and Mitigations

| 风险 | 缓解措施 |
| --- | --- |
| 漏删某一层、helper 或 cache 导致编译失败或死标识符残留 | 对完整标识符集合运行 `rg` 负向检查，并执行 TypeScript build 与 Rust check。 |
| 误删仍由 quota/reset credits 使用的 Codex import 或 helper | 删除后运行现有 Rust tests，并限制 diff 仅覆盖明确锚点。 |
| 与 PR #31 冲突或混入无关变更 | implementation branch 在 spec 合并后的最新 `origin/main` 创建；最终 diff 必须符合 GH32 七路径精确 allowlist。 |
| allowlist 在缺失或不可解析的 `origin/main` 上静默放行 | 显式 fetch `main` 到 remote-tracking ref，再用 `git diff --quiet` 与排除 pathspec 检查范围；缺 base、diff 错误或额外文件都返回非零。 |
| 仓库外部调用内部 Tauri command | 当前 command 未文档化且无仓库消费者；不承诺兼容。若实现前发现正式外部契约证据，则停止并修订 spec。 |

## Product-to-Test Mapping

| Behavior invariant | Implementation area | Verification |
| --- | --- | --- |
| `B-001` 现有用户行为不变 | 所有删除点；保留现有 provider/cost/tray paths | `npm test`; `npm run build`; `cargo test --manifest-path src-tauri/Cargo.toml` |
| `B-002` stats 能力完全移除 | `src/types/models.ts`, `src/services/backend.ts`, `src-tauri/src/domain/models.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/services/codex.rs` | `if rg -n "getCodexStats|get_codex_stats|CodexStats|HistoryStatsCache|HISTORY_STATS_CACHE|history_stats_cache|update_stats_from_reader|build_codex_stats|fetch_codex_stats|history\\.jsonl" src src-tauri/src tests; then false; else rg_status=$?; test "$rg_status" -eq 1; fi` |
| `B-003` 仍在使用的 Codex paths 不变且无 shim | `src-tauri/src/services/codex.rs`, command registry, backend facade | `git diff origin/main...HEAD -- src-tauri/src/services/codex.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/services/backend.ts`; `cargo test --manifest-path src-tauri/Cargo.toml` |
| `B-004` 完成证据完整 | implementation PR verification record | 连续执行本 spec 的完整 Test Plan 并记录退出码为 0 |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)src/types/models.ts' \
  ':(exclude)src/services/backend.ts' \
  ':(exclude)src-tauri/src/domain/models.rs' \
  ':(exclude)src-tauri/src/commands.rs' \
  ':(exclude)src-tauri/src/lib.rs' \
  ':(exclude)src-tauri/src/services/codex.rs' \
  ':(exclude)specs/GH32/tasks.md'
if rg -n "getCodexStats|get_codex_stats|CodexStats|HistoryStatsCache|HISTORY_STATS_CACHE|history_stats_cache|update_stats_from_reader|build_codex_stats|fetch_codex_stats|history\.jsonl" src src-tauri/src tests; then
  false
else
  rg_status=$?
  test "$rg_status" -eq 1
fi
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Rollback Plan

回滚 implementation PR。该变更不迁移数据、不修改用户配置；回滚只会恢复未消费的内部 API 和历史扫描代码。

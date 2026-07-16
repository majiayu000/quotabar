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
| `src-tauri/src/services/codex.rs:107` | JSONL reader 与 stats builder | 删除仅服务死能力的转换函数。 |
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
| 漏删某一层导致编译失败或死标识符残留 | 运行目标 `rg` 负向检查、TypeScript build 与 Rust check。 |
| 误删仍由 quota/reset credits 使用的 Codex import 或 helper | 删除后运行现有 Rust tests，并限制 diff 仅覆盖明确锚点。 |
| 与 PR #31 冲突或混入 pricing 变更 | implementation branch 在 spec 合并后的最新 `origin/main` 创建；不改 `cost.rs`、`codex_pricing.rs`、`specs/GH10/*`。 |
| 仓库外部调用内部 Tauri command | 当前 command 未文档化且无仓库消费者；不承诺兼容。若实现前发现正式外部契约证据，则停止并修订 spec。 |

## Product-to-Test Mapping

| Behavior invariant | Implementation area | Verification |
| --- | --- | --- |
| `B-001` 现有用户行为不变 | 所有删除点；保留现有 provider/cost/tray paths | `npm test`; `npm run build`; `cargo test --manifest-path src-tauri/Cargo.toml` |
| `B-002` stats 能力完全移除 | `src/types/models.ts`, `src/services/backend.ts`, `src-tauri/src/domain/models.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/services/codex.rs` | `! rg -n "getCodexStats|get_codex_stats|CodexStats|HistoryStatsCache|fetch_codex_stats" src src-tauri/src tests` |
| `B-003` 仍在使用的 Codex paths 不变且无 shim | `src-tauri/src/services/codex.rs`, command registry, backend facade | `git diff origin/main...HEAD -- src-tauri/src/services/codex.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/services/backend.ts`; `cargo test --manifest-path src-tauri/Cargo.toml` |
| `B-004` 完成证据完整 | implementation PR verification record | 连续执行本 spec 的完整 Test Plan 并记录退出码为 0 |

## Test Plan

```bash
! rg -n "getCodexStats|get_codex_stats|CodexStats|HistoryStatsCache|fetch_codex_stats" src src-tauri/src tests
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Rollback Plan

回滚 implementation PR。该变更不迁移数据、不修改用户配置；回滚只会恢复未消费的内部 API 和历史扫描代码。

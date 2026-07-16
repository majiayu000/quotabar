# GH-32 Product Spec：移除未使用的 Codex stats 命令链路

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/32
- `complexity: small`

## 背景

QuotaBar 当前暴露了 `get_codex_stats` Tauri command 及对应的前后端类型、包装和本地历史扫描实现，但应用内没有任何调用方或展示入口。继续保留这条死链路会扩大维护面，并可能让未来调用方把文件读取失败后的全零回退误认为真实统计。

## Goals

- 删除没有运行时消费者的 Codex stats 能力，缩小跨 TypeScript、Tauri command 和 Rust domain/service 的 API 面积。
- 保持现有 Claude、Codex quota、Codex reset credits、Cursor、Antigravity、cost 与 tray 行为不变。
- 用可重复的静态检查和完整构建/测试证明删除完整且没有遗留引用。

## Non-Goals

- 不新增 Codex session statistics UI 或替代 API。
- 不改变 Codex 账号、配额窗口、reset credits、cost 或 pricing 语义。
- 不修改 PR #31 的 `cost.rs`、`codex_pricing.rs` 或 `specs/GH10/*` 范围。
- 不顺带清理其他 provider 或其他静默回退路径。

## Behavior Invariants

1. `B-001` 删除完成后，现有用户可见的 provider 连接、quota、reset credits、cost、tray 与设置行为必须保持不变。
2. `B-002` 应用不再暴露或注册 `get_codex_stats`，前端也不再声明 `getCodexStats` 或 `CodexStats`；仓库内不得保留该死能力的可调用入口。
3. `B-003` 删除不得改变仍在使用的 Codex 认证读取、rate-limit 请求、reset-credit 请求及其错误状态；未消费的历史统计链路不得被替换为新的 fallback 或兼容 shim。
4. `B-004` 完成证据必须同时包含目标标识符全仓无结果、前端测试/构建通过以及 Rust fmt/check/test 通过；缺少任一类证据不得宣称完成。

## Acceptance Criteria

- `src/`、`src-tauri/src/`、`tests/` 中不再出现 `getCodexStats`、`get_codex_stats`、`CodexStats`、`HistoryStatsCache` 或 `fetch_codex_stats`。
- 应用现有前端测试全部通过，生产前端构建成功。
- Rust formatting、compile check 和 unit tests 全部通过。
- implementation PR 只包含 GH-32 所需删除和任务状态更新，不包含 PR #31 或其他优化项。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| Empty / missing input | N/A：该变更删除未调用能力，不引入输入。 |
| Error and failure paths | covered: `B-003`，仍在使用的 Codex 错误状态不得改变。 |
| Authorization / permission | N/A：不改变认证或权限判断。 |
| Concurrency / race / ordering | N/A：被删除能力没有运行时调用方；不引入并发状态。 |
| Retry / repetition / idempotency | N/A：删除本身无运行时重试语义。 |
| Illegal state transitions | N/A：不新增状态机。 |
| Compatibility / migration | covered: `B-001`, `B-002`, `B-003`；保留用户行为，但不为未文档化、未消费的内部 command 保留 shim。 |
| Degradation / fallback | covered: `B-003`；不得用新的 fallback 伪装已删除能力。 |
| Evidence and audit integrity | covered: `B-004`，静态与动态验证缺一不可。 |
| Cancellation / interruption / partial completion | covered: `B-002`, `B-004`；残留任一层声明或缺失验证均视为未完成。 |

## Open Questions

- 无。仓库搜索已经确认没有运行时消费者；若 implementation 阶段发现外部生成代码或文档依赖，应停止删除并更新本 spec。

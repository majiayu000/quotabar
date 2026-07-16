# GH-10 Product Spec: Local Cost Standard API Pricing

## Linked Issue

- Issue: `#10` — Fix local cost refresh and Codex pricing
- Complexity: small
- Revision: standard API pricing supersedes the earlier model-name-based pricing assumption.

## Goals

- `LOCAL COST` 在应用保持打开时持续刷新，不会因为只在组件挂载时查询一次而长时间停在旧值。
- Today、This Week、This Month、7D 和 30D 统一展示 ccstats 返回的标准 API 等价成本。
- QuotaBar 不根据模型名称推断请求的服务等级或处理区域。
- Tauri command 返回字符串错误时，前端展示真实错误文本，而不是泛化成 `Failed to load cost summary`。

## Behavior Invariants

1. `B-001` 成本组件必须按默认自动刷新节奏更新；定时刷新必须绕过 QuotaBar 五分钟缓存。
2. `B-002` ccstats 返回的 `cost` / `cost_usd` 必须原样进入每日与总览响应，所有时间范围使用同一价格口径。
3. `B-003` QuotaBar 不得仅凭模型名称推断服务等级或区域，也不得在 ccstats 结果之上再次调整价格。
4. `B-004` Tauri 返回的非空字符串错误必须原样显示；空字符串或未知错误才使用通用错误文案。
5. `B-005` Rust、TypeScript、前端测试和桌面端构建必须通过后才能报告实现完成。

## Non-Goals

- 不改变 `CostOverview` 或 `CostDailySeries` 的前端响应字段。
- 不新增 provider、价格配置 UI 或远程网络请求。
- 不修改 ccstats 上游包或自行维护第二份模型价格表。
- 不从本地日志推断 API `service_tier`、数据处理区域或实际账单金额。

## Boundary Checklist

| Category | Verdict |
| --- | --- |
| Empty / missing input | Covered by `B-004`;未知错误使用通用错误文案。 |
| Error and failure paths | Covered by `B-004`;后端错误不得静默吞掉。 |
| Authorization / permission | N/A；成本汇总读取本地使用记录，不新增权限模型。 |
| Concurrency / race / ordering | Covered by `B-001`;刷新沿用现有取消与 interval 清理逻辑。 |
| Retry / repetition / idempotency | Covered by `B-001`;force refresh 可重复执行。 |
| Illegal state transitions | N/A；该功能没有持久化状态机。 |
| Compatibility / migration | Covered by `B-002`、`B-003`;API 响应结构不变，仅统一价格口径。 |
| Degradation / fallback | Covered by `B-004`;失败必须显示错误，不能伪装成成功。 |
| Evidence and audit integrity | Covered by `B-005`;完成声明必须有新鲜验证证据。 |
| Cancellation / interruption | Covered by `B-001`;组件卸载时清理 interval 并忽略已取消请求。 |

## Acceptance Criteria

- 自动刷新行为保持不变，interval tick 使用 force refresh。
- Codex 每日和总览成本与 ccstats 标准 API 成本一致。
- 代码库中不存在 QuotaBar 自有的 Codex 服务等级或区域价格覆盖模块。
- 前端继续保留真实 Tauri 字符串错误。
- `cargo check`、`cargo test`、`npx tsc --noEmit`、前端测试和桌面端构建通过。

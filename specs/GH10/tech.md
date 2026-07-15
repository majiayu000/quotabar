# GH-10 Tech Spec: Local Cost Standard API Pricing

## Proposed Design

前端 `CostSummarySection` 保留默认自动刷新 interval。interval 触发时调用 force refresh，让后端重建成本总览和每日序列；组件卸载时继续清理 interval。

后端保留 ccstats multi-range 聚合路径，并直接映射 ccstats 返回的 `cost`、`cost_usd`、tokens 和 models：

- 每日序列由 `src-tauri/src/services/cost.rs:185` 开始映射 ccstats daily summaries。
- Today、This Week、This Month 由 `src-tauri/src/services/cost.rs:292` 开始构建并在 `:306` 映射 summaries。
- QuotaBar 不再读取 ccstats pricing cache，也不维护 Codex 专用的二次价格计算模块。
- `CostOverview`、`CostDailySeries` 及前端类型保持不变。

前端错误展示继续使用 error normalization helper。Tauri command rejection 可能是字符串，不一定是 `Error` 实例；非空字符串错误必须原样展示。

## Product-to-Test Mapping

| Behavior invariant | Implementation area | Verification |
| --- | --- | --- |
| `B-001` 自动 force refresh 与卸载清理 | `src/components/CostSummarySection.tsx:220-272` | `npm test -- --run tests/cost_summary_error.test.ts` |
| `B-002` ccstats 成本原样映射 | `src-tauri/src/services/cost.rs:185-205`、`:292-317` | `cargo test --manifest-path src-tauri/Cargo.toml preserves_ccstats_standard_api_costs`；运行 ignored daily smoke test |
| `B-003` 不推断服务等级或区域 | `src-tauri/src/services/cost.rs`；`src-tauri/src/services/mod.rs` | `rg -n "codex_pricing|input_cost_per_token_priority|regional_processing_uplift_multiplier_us" src-tauri/src` 返回空 |
| `B-004` 字符串错误原样展示 | `src/components/CostSummarySection.tsx` | `npm test -- --run tests/cost_summary_error.test.ts` |
| `B-005` 完整验证证据 | Rust、TypeScript、Vitest、Tauri bundle | 运行下方 Test Plan 全部命令 |

## Risks

- ccstats 价格表更新会直接改变展示金额；这是单一价格来源的预期行为。
- 标准 API 等价成本不是 ChatGPT 套餐的实际账单，UI 不应将其解释为真实扣费。
- 未知模型的价格处理继续由 ccstats 决定，QuotaBar 不做静默的第二层估算。

## Test Plan

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml daily_series_smoke -- --ignored --nocapture`
- `npx tsc --noEmit`
- `npm test -- --run`
- `npm run tauri -- build --bundles app`

## Rollback Plan

回滚本次标准 API 价格透传提交。回滚前必须重新确认替代价格来源包含可靠的请求级服务等级和区域证据，不能只根据模型名称推断。

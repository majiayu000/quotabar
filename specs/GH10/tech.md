# GH-10 Tech Spec: Local Cost Pricing Policy

## Proposed Design

前端 `CostSummarySection` 增加默认自动刷新 interval。interval 触发时调用 `backend.getCostOverview(source, true)`，让后端强制重建成本摘要。组件卸载时清理 interval。

前端错误展示使用一个小的 error normalization helper。Tauri command rejection 可能是字符串，不一定是 `Error` 实例；字符串错误必须原样展示，空字符串或未知错误才回退到 `Failed to load cost summary`。

后端保留 ccstats 的 multi-range 聚合路径，但在 Codex + USD 的结果映射完成后增加 QuotaBar 本地 pricing policy 层：

- 优先从 ccstats upstream 使用的 `~/.cache/ccstats/pricing.json` 读取 LiteLLM 价格表，并保留 `dirs::cache_dir()/ccstats/pricing.json` 作为兼容 fallback。
- 对 `gpt-5.4` / `gpt-5.5` 要求存在 `input_cost_per_token_priority`、`output_cost_per_token_priority`、`cache_read_input_token_cost_priority` 和 `regional_processing_uplift_multiplier_us`。
- 使用 `input_tokens * priority_input + (output_tokens + reasoning_tokens) * priority_output + cache_read_tokens * priority_cache_read`，再乘以 US regional multiplier。
- 未知模型保留 ccstats 原始成本；已知 Codex 模型缺少 policy 时返回错误，防止 silent low estimate。

将 pricing cache 读取和计算拆到独立 service module，避免 `cost.rs` 继续承载价格表细节。

## Test Plan

- 单元测试 pricing JSON 解析和 `gpt-5.5` priority + US regional 成本计算。
- 单元测试 pricing cache 第一个候选路径不存在时会继续读取 fallback 路径。
- 单元测试缺失 priority/regional 字段时返回错误。
- 单元测试 Codex USD range 会重算模型和 range 成本。
- 单元测试 Tauri 字符串错误不会被泛化吞掉。
- 运行 `cargo check --manifest-path src-tauri/Cargo.toml`。
- 运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 运行 `npx tsc --noEmit`。
- 运行 `npm test -- --run`。
- 运行 `npm run tauri -- build --bundles app`。

## Rollback Plan

回滚 `CostSummarySection` 的 interval 逻辑和后端 pricing policy module。回滚后 QuotaBar 会恢复只展示 ccstats 当前返回成本的行为。

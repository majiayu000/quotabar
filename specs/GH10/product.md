# GH-10 Product Spec: Local Cost Pricing Policy

## Goals

- `LOCAL COST` 在应用保持打开时会持续刷新，不会因为只在组件挂载时查询一次而长时间停在旧值。
- Codex 本地成本对 `gpt-5.4` / `gpt-5.5` 使用 ccstats pricing cache 中的 priority 价格和 US regional multiplier，避免把 priority 使用量按 base 价格低估。
- 当 QuotaBar 无法取得已知 Codex 模型所需的 priority/regional 价格字段时，用户看到错误，而不是继续展示明显偏低的金额。
- Tauri command 返回字符串错误时，前端展示真实错误文本，而不是泛化成 `Failed to load cost summary`。

## Non-Goals

- 不改变 `CostOverview` 的前端响应字段。
- 不新增 provider、价格配置 UI 或远程网络请求。
- 不修改 ccstats 上游包。
- 不关闭 GitHub issue；最终关闭动作需要人类 gate。

## Acceptance Criteria

- 成本组件有默认自动刷新节奏，刷新时强制绕过 QuotaBar 五分钟缓存。
- Codex USD 成本在本地根据 `~/.cache/ccstats/pricing.json` 重新应用 priority 价格和 US regional multiplier。
- `gpt-5.4` / `gpt-5.5` 的 price policy 缺失或字段不完整时，后端返回明确错误。
- 成本 UI 能展示 Tauri 返回的字符串错误。
- 非 USD range 不应用 USD regional policy。
- Rust 和 TypeScript 验证通过。

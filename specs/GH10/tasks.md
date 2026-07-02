# GH-10 Tasks: Local Cost Pricing Policy

## Implementation Tasks

- [x] `LCOST-T1` Owner: codex. Done when: GitHub issue #10 和 `specs/GH10` 记录目标、技术方案和验收标准。Verify: `gh issue view 10 --json number,title,url,state` and `find specs/GH10 -maxdepth 1 -type f -print`.
- [x] `LCOST-T2` Owner: codex. Done when: `CostSummarySection` 默认自动刷新并在 interval tick 时 force refresh。Verify: `npx tsc --noEmit`.
- [x] `LCOST-T3` Owner: codex. Done when: Codex priority/regional pricing 从 ccstats pricing cache 解析，不再把 `gpt-5.4` / `gpt-5.5` 价格硬编码在 `cost.rs`。Verify: `rg -n "input_cost_per_token_priority|regional_processing_uplift_multiplier_us|gpt-5\\.5" src-tauri/src/services`.
- [x] `LCOST-T4` Owner: codex. Done when: pricing policy 缺失会返回明确错误，USD Codex range 会按 priority/regional 重算。Verify: `cargo test --manifest-path src-tauri/Cargo.toml codex_pricing::tests` and `cargo test --manifest-path src-tauri/Cargo.toml cost::tests`.
- [x] `LCOST-T5` Owner: codex. Done when: Tauri 字符串错误能在成本 UI 中保留真实错误文本。Verify: `npm test -- --run`.
- [x] `LCOST-T6` Owner: codex. Done when: QuotaBar 优先读取 ccstats upstream 的 `~/.cache/ccstats/pricing.json`，并在第一个候选路径缺失时继续读取 fallback。Verify: `cargo test --manifest-path src-tauri/Cargo.toml codex_pricing::tests`.
- [x] `LCOST-T7` Owner: codex. Done when: 项目验证与 app bundle 构建通过。Verify: `cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml && npx tsc --noEmit && npm test -- --run && npm run tauri -- build --bundles app`.

## Handoff Notes

Linked issue: https://github.com/majiayu000/quotabar/issues/10

`implx` 以 single-agent bounded tranche 执行；没有创建 PR，没有执行 merge/close gate。

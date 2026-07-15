# GH-10 Tasks: Local Cost Standard API Pricing

## Implementation Tasks

- [x] `LCOST-T1` Owner: codex. Dependencies: none. Done when: GitHub issue `#10` 和 `specs/GH10` 记录目标、设计与验收标准。 Verify: `find specs/GH10 -maxdepth 1 -type f -print`. Covers: `B-001`–`B-005`.
- [x] `LCOST-T2` Owner: codex. Dependencies: `LCOST-T1`. Done when: `CostSummarySection` 默认自动刷新并在 interval tick 时 force refresh。 Verify: `npm test -- --run tests/cost_summary_error.test.ts`. Covers: `B-001`.
- [x] `LCOST-T3` Superseded by `LCOST-T8`;保留 ID 作为历史记录，不再代表当前价格策略。 Covers: none（历史 tombstone）。
- [x] `LCOST-T4` Superseded by `LCOST-T8` 和 `LCOST-T9`;保留 ID 作为历史记录。 Covers: none（历史 tombstone）。
- [x] `LCOST-T5` Owner: codex. Dependencies: `LCOST-T2`. Done when: Tauri 字符串错误能在成本 UI 中保留真实错误文本。 Verify: `npm test -- --run tests/cost_summary_error.test.ts`. Covers: `B-004`.
- [x] `LCOST-T6` Superseded by `LCOST-T8`;保留 ID 作为历史记录。 Covers: none（历史 tombstone）。
- [x] `LCOST-T7` Owner: codex. Dependencies: `LCOST-T2`、`LCOST-T5`. Done when: 初始刷新与错误处理验证通过。 Verify: `cargo check --manifest-path src-tauri/Cargo.toml && npx tsc --noEmit && npm test -- --run`. Covers: `B-001`、`B-004`、`B-005`.
- [x] `LCOST-T8` Owner: codex. Dependencies: `LCOST-T1`. Done when: 删除 QuotaBar 自有的 Codex 服务等级/区域重定价模块，每日与总览直接使用 ccstats 成本。 Verify: `rg -n "codex_pricing|input_cost_per_token_priority|regional_processing_uplift_multiplier_us" src-tauri/src` 返回空。 Covers: `B-002`、`B-003`.
- [x] `LCOST-T9` Owner: codex. Dependencies: `LCOST-T8`. Done when: 回归测试通过最终 daily 和 overview 响应构造路径，证明 ccstats 标准 API 成本原样进入响应。 Verify: `cargo test --manifest-path src-tauri/Cargo.toml final_responses_preserve_ccstats_standard_api_costs`. Covers: `B-002`、`B-003`.
- [x] `LCOST-T10` Owner: codex. Dependencies: `LCOST-T7`、`LCOST-T8`、`LCOST-T9`. Done when: Rust、TypeScript、前端测试、真实本地数据 smoke test 与双平台 bundle CI 通过。 Verify: 执行 `specs/GH10/tech.md` 的 Test Plan 并检查 PR status checks。 Covers: `B-005`.

## Handoff Notes

- Linked issue: https://github.com/majiayu000/quotabar/issues/10
- Implementation PR: https://github.com/majiayu000/quotabar/pull/31
- 本修订明确以 ccstats 标准 API 成本取代旧的模型名称推断策略。
- 最终合并仍需最新 CI、review threads 和 human merge authorization 证据。

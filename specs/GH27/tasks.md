# GH-27 Tasks

## Implementation Tasks

- [x] `SP27-T1` Owner: codex. Done when: QuotaBar has a SpecRail packet for the local cost multi-range work. Verify: `env PYTHONDONTWRITEBYTECODE=1 python3 /Users/apple/Desktop/code/AI/tool/specrail/checks/check_workflow.py --repo /Users/apple/Desktop/code/AI/tool/specrail --spec-dir "$(pwd)/specs/GH27"`.
- [x] `SP27-T2` Owner: codex. Done when: ccstats is pinned to a revision that exposes `summarize_cost_ranges`. Verify: `rg -n "summarize_cost_ranges|7dbfad0ffc29277da22cd095db067e88982f3f12" src-tauri`.
- [x] `SP27-T3` Owner: codex. Done when: local cost overview uses one multi-range SDK call for today/week/month. Verify: `rg -n "summarize_cost\\(" src-tauri/src/services/cost.rs` returns no matches.
- [x] `SP27-T4` Owner: codex. Done when: mapping and mismatch behavior are covered by Rust unit tests. Verify: `cargo test --manifest-path src-tauri/Cargo.toml cost::tests`.
- [x] `SP27-T5` Owner: codex. Done when: project verification passes. Verify: `cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml && npx tsc --noEmit && npm test -- --run`.

## Verification

Record fresh command output in the final report.

## Handoff Notes

This packet references upstream ccstats #27 because QuotaBar has no open local issue for this integration.

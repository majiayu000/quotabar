# GH-45 Tasks：无输出漂移地拆分 redesign stylesheet

## Delivery Contract

- Base: spec PR 与 implementation PR 均从各自创建时 then-latest `origin/main` 派生。
- Commit policy: `per_step`。
- Backward compatibility: source stream、CSS cascade、production CSS asset bytes、frontend/desktop behavior required。
- Scope exclusion: legacy styles、redesign settings、App/component split、selector cleanup、formatter、dependency/build config。

## Implementation Tasks

- [x] `SP45-T1` Owner: codex. Dependencies: merged GH45 spec PR. Covers: `B-006`. Done when: fresh implementation branch 上 edit 前确认 `src/redesign.css` 为 861 行/15,665 bytes/source SHA exact，App 为 26,016 bytes/App SHA exact 且每个 `.css` line 与 five-item baseline exact，baseline build 为一个 52,095-byte/bundle SHA exact asset；任一漂移则停止并更新 spec。 Verify: 执行 tech spec Preflight Contract 与双引号 import adversarial check。
- [ ] `SP45-T2` Owner: codex. Dependencies: `SP45-T1`. Covers: `B-001`, `B-002`. Done when: 原 1~223、224~861 行机械移动到 shell/panels；旧文件删除；line counts 精确 223/638、各 ≤800，ordered Buffer concat 15,665 bytes/source SHA exact；无 formatter 或 semantic edit。 Verify: 执行 tech spec source parity gate。
- [ ] `SP45-T3` Owner: codex. Dependencies: `SP45-T2`. Covers: `B-003`, `B-004`. Done when: current App 精确等于 `origin/main:src/App.tsx` 仅做唯一 redesign import 1→2 replacement 后的 computed expected；每个含 `.css` 的 App line 与 six-item expected exact；没有 `@import`；production bundle count/size/SHA exact。 Verify: 执行 exact App/all-CSS-lines/bundle gates。
- [ ] `SP45-T4` Owner: codex. Dependencies: `SP45-T2`, `SP45-T3`. Covers: `B-005`. Done when: implementation diff 只含 5-path allowlist；exact App gate 证明零 executable/formatting/额外 import edit；diff coverage 因零 measurable lines 为 N/A 且不加入 dummy code；无其他 CSS/TS/config/dependency change。 Verify: allowlist、`git diff --check`、exact parity 与全量 tests。

## Verification Tasks

- [ ] `SP45-T5` Owner: codex. Dependencies: `SP45-T1`~`SP45-T4`. Covers: `B-001`~`B-006`. Done when: final implementation HEAD 上 source/App/import/bundle parity、`git diff --check`、`npm test`、build、Rust fmt/check/test 全部新鲜通过。 Verify: 执行 tech spec 完整 Test Plan。
- [ ] `SP45-T6` Owner: codex. Dependencies: `SP45-T5`. Covers: none（handoff）. Done when: implementation PR 以 `Closes #45` 链接 issue，正文记录原因、边界、parity、coverage applicability、风险、rollback 与验证，并接受 implementation-vs-spec、current-head connector/CI/reviewThreads gate。 Verify: `gh pr view --json body,headRefOid,statusCheckRollup,mergeStateStatus,url`。

## Handoff Notes

- Product invariant set: `{B-001, B-002, B-003, B-004, B-005, B-006}`。
- Task coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006}`。
- Spec PR 只提交本目录三份文档；implementation PR 才移动 CSS、修改 App import 并勾选 tasks。
- 用户已提供持续 issue/PR/CI fix/merge 授权；仍禁止 force push、parity gate 降级、CSS semantic edit 或扩大 scope。

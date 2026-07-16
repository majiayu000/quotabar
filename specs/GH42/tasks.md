# GH-42 Tasks：无输出漂移地拆分 legacy stylesheet

## Delivery Contract

- Base: spec PR 与 implementation PR 均从各自创建时 then-latest `origin/main` 派生。
- Commit policy: `per_step`。
- Backward compatibility: source stream、CSS cascade、production CSS asset bytes、frontend/desktop behavior required。
- Scope exclusion: redesign styles、App/component split、selector/declaration cleanup、formatter、dependency/build config。

## Implementation Tasks

- [x] `SP42-T1` Owner: codex. Dependencies: merged GH42 spec PR. Covers: `B-006`. Done when: fresh implementation branch 上 edit 前确认 `src/styles.css` 为 1,906 行/source SHA exact，App CSS imports 为 legacy+两 redesign baseline，baseline build 为一个 52,095-byte/bundle SHA exact asset；任一漂移则停止并更新 spec。 Verify: 执行 tech spec Preflight Contract 的 source/import/build checks。
- [x] `SP42-T2` Owner: codex. Dependencies: `SP42-T1`. Covers: `B-001`, `B-002`. Done when: 原 1~726、727~1324、1325~1906 行机械移动到 foundation/content/views；旧文件删除；三个 line count 精确 726/598/582、各 ≤800，ordered Buffer concat source SHA exact；没有 formatter 或 semantic edit。 Verify: 执行 tech spec source parity Node gate。
- [ ] `SP42-T3` Owner: codex. Dependencies: `SP42-T2`. Covers: `B-003`, `B-004`. Done when: App current bytes 精确等于 `origin/main:src/App.tsx` 仅执行唯一 legacy import 1→3 replacement 后的 computed expected；CSS imports 按 foundation/content/views/redesign/redesign-settings 排列；没有 `@import`；`npm run build` 仍仅一个 52,095-byte CSS asset且 bundle SHA exact。 Verify: 执行 tech spec exact App replacement、import array与 bundle parity Node gates。
- [ ] `SP42-T4` Owner: codex. Dependencies: `SP42-T2`, `SP42-T3`. Covers: `B-005`. Done when: implementation diff 只含 6-path allowlist；exact App replacement gate 证明零 executable/formatting/双引号 import 等其他 App edit；明确记录 GH35 diff checker 因零 measurable lines 为 N/A，不加入 dummy code；无其他 CSS/TS/config/dependency change。 Verify: 执行 tech spec static allowlist、exact App/source/import/bundle gates 与全量 tests。

## Verification Tasks

- [ ] `SP42-T5` Owner: codex. Dependencies: `SP42-T1`~`SP42-T4`. Covers: `B-001`~`B-006`. Done when: final implementation HEAD 上 source/import/bundle parity、`npm test`、build、Rust fmt/check/test 全部新鲜通过。 Verify: 执行 tech spec 完整 Test Plan。
- [ ] `SP42-T6` Owner: codex. Dependencies: `SP42-T5`. Covers: none（handoff）. Done when: implementation PR 以 `Closes #42` 链接 issue，正文写明原因、机械边界、source/bundle parity、风险、rollback 与验证证据，并接受 implementation-vs-spec、current-head connector/CI/reviewThreads gate。 Verify: `gh pr view --json body,headRefOid,statusCheckRollup,mergeStateStatus,url`。

## Handoff Notes

- Product invariant set: `{B-001, B-002, B-003, B-004, B-005, B-006}`。
- Task coverage union: `{B-001, B-002, B-003, B-004, B-005, B-006}`。
- Spec PR 只提交本目录三份文档；implementation PR 才移动 CSS、修改 App import并勾选 tasks。
- 用户已提供持续 issue/PR/CI fix/merge 授权；仍禁止 force push、hash gate 降级、CSS semantic edit 或扩大 scope。

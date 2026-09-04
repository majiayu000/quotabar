# GH-93 Tasks：Codex exhausted panel

## Delivery Contract

- Base: then-latest `origin/main`。可与 #94 / #95 平行设计，implementation 不要叠 #94 的通知 key。
- Commit policy: `per_step`。
- Scope: Codex 打满层级、估值软降级、Bonus 跳转、Tip / last updated / extras 文案。
- Compatibility: 官方 limits / reset-credit payload、dashboard URL、其它 provider 面板、通知 schema 不变。

## Implementation Tasks

- [x] `SP93-T1` Owner: impl. Dependencies: this spec. Covers: `B-004`, `B-005`, `B-010`. Done when: weekly value 年龄-only 为 soft Last estimate；hard 失败仍隐藏；reset 漂移后旧值消失。 Verify: `tests/provider_refresh_races.test.tsx` 估值矩阵。
- [x] `SP93-T2` Owner: impl. Dependencies: T1. Covers: `B-001`~`B-003`, `B-006`, `B-007`. Done when: 打满层级、Bonus CTA、合并 extras 文案、exhausted Tip、header `Weekly exhausted` 全绿；未打满路径视觉顺序不变。 Verify: `tests/codex_exhausted_panel.test.tsx` + `tests/detail_helpers.test.ts`。
- [x] `SP93-T3` Owner: impl. Dependencies: T2. Covers: `B-008`, `B-009`. Done when: last updated 在官方成功后出现；Refresh 在仅 extras 过期时不写 error banner；footer 仍为 Dashboard；官方 100% 不被 extras 改写。 Verify: exhausted panel + 既有 Codex refresh tests。
- [x] `SP93-T4` Owner: impl. Dependencies: T1-T3. Covers: `B-001`~`B-010`. Done when: allowlist 外无 diff；`npx tsc --noEmit && npm test && npm run build` 通过。 Verify: tech Test Plan。

## Handoff

- [x] `SP93-T5` Owner: impl. Dependencies: T4. Done when: implementation PR `Closes #93`，正文链到分析文档与本 spec，并写明不核销 reset、不改 opener URL。

## Handoff Notes

- Invariants: `{B-001 … B-010}`。
- 禁止把校验原文渲染进 JSX、禁止新增核销 API、禁止改 Grok 估值门、禁止改通知 schema。

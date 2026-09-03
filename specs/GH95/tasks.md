# GH-95 Tasks：settings control surface

## Delivery Contract

- Base: 已含 #94 的 `main`（或 stacked on #94）。不要叠 #93 的 Codex 布局 diff。
- Commit policy: `per_step`。
- Scope: 预设、Limits/Alerts 拆组、event 导航。
- Compatibility: GH-61 guard、通知 key、无新 native plugin。

## Implementation Tasks

- [x] `SP95-T1` Owner: impl. Dependencies: this spec + #94 merged. Covers: `B-001`, `B-002`, `B-006`. Done when: preset 纯函数 + App handler 一次 persist；零 panel / 零 tray 不可能。 Verify: `tests/provider_presets.test.ts`。
- [x] `SP95-T2` Owner: impl. Dependencies: T1. Covers: `B-003`, `B-005`. Done when: Limits 与 Alerts 分 group；其它组行为不变。 Verify: settings render test。
- [x] `SP95-T3` Owner: impl. Dependencies: T1. Covers: `B-004`. Done when: 带 provider label 的 event 回到对应 tab 并关闭 Settings；无 label 只读。 Verify: settings events navigation test。
- [x] `SP95-T4` Owner: impl. Dependencies: T1-T3. Covers: `B-001`~`B-006`. Done when: 无 `src-tauri` diff；GH-61 测试仍绿；`npx tsc --noEmit && npm test && npm run build`。 Verify: tech Test Plan。

## Handoff

- [x] `SP95-T5` Owner: impl. Dependencies: T4. Done when: implementation PR `Closes #95`。Launch at Login follow-up 已开：https://github.com/majiayu000/quotabar/issues/96。

## Handoff Notes

- Invariants: `{B-001 … B-006}`。
- 禁止 autostart 插件、禁止刷新滑条、禁止改通知语义。

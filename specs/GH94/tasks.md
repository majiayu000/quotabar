# GH-94 Tasks：quota lifecycle alerts

## Delivery Contract

- Base: then-latest `origin/main`。可与 #93 平行；不要在本 PR 改 exhausted 布局。
- Commit policy: `per_step`。
- Scope: 通知 schema、100% 跨越、Codex bonusReady、Settings 行。
- Compatibility: 80/95/bonus expiry body、12h dedupe、GH-48 helper 不变。

## Implementation Tasks

- [x] `SP94-T1` Owner: impl. Dependencies: this spec. Covers: `B-001`, `B-007`. Done when: 五 key defaults、旧 JSON 兼容、NOTIFICATION_ROWS 五行、夹具补全。 Verify: `tests/notifications.test.ts` + tsc。
- [x] `SP94-T2` Owner: impl. Dependencies: T1. Covers: `B-002`, `B-005`, `B-006`. Done when: used% 跨越 100 独立于 80/95；同帧 95+100；关 q100 仍 log；notify helper exact。 Verify: service events tests。
- [x] `SP94-T3` Owner: impl. Dependencies: T1. Covers: `B-003`, `B-004`. Done when: Codex exhausted∧availableCount 边沿触发 bonusReady；稳定 refresh 不重复；expiry 路径与文案不变。 Verify: Codex/App bonusReady tests。
- [x] `SP94-T4` Owner: impl. Dependencies: T1-T3. Covers: `B-001`~`B-007`. Done when: allowlist 外无面板层级 diff；`npx tsc --noEmit && npm test && npm run build`。 Verify: tech Test Plan。

## Handoff

- [x] `SP94-T5` Owner: impl. Dependencies: T4. Done when: implementation PR `Closes #94`，写明启动时已 100% 有券不补发（无 prev）。

## Handoff Notes

- Invariants: `{B-001 … B-007}`。
- 禁止自定义阈值、禁止改 12h 窗口、禁止在本 PR 做 #93 UI。

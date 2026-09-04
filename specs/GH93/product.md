# GH-93 Product Spec：Codex 打满态首屏与 same-window 估值

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/93
- `complexity: high`
- Analysis: `docs/product/codex-exhausted-and-settings-analysis.md`
- Follow-ups: #94 (lifecycle alerts), #95 (settings control surface)

## Problem

Codex Weekly 官方 100% 时，面板仍按「正常监控」布局说话：

- 本机 weekly value 已算出来，却因 `observedAt` 超过 10 分钟被整卡隐藏。
- Local pace 与 weekly value 各丢一句英文校验错误，看起来像同步故障。
- Tip 再复读一遍 100%。
- 唯一出路（Gifted bonus reset）在底部且不可点。
- Refresh 与页脚 Dashboard 没有情境。

现场证据：ChatGPT Plus、7-day window 100%、`Resets in 3d 16h`、两条 `unavailable`、Tip `Codex Weekly is at 100%.`、Bonus `1 available`。

## Goals

- 官方周窗口打满时，首屏回答「被挡住 / 还要多久 / 有没有券」，而不是解释校验。
- 同一官方周窗口、用量仍对齐时，过期估值降级展示，不隐藏。
- Bonus reset 成为只读跳转的主行动；QuotaBar 不核销。
- 本地 extras 过期用一句人话 + last updated，不再渲染校验原文。
- Claude / Cursor / Grok / Antigravity 面板语义不变。

## Non-Goals

- 不内核销 reset credit，不新增写 ChatGPT 的 command。
- 不改通知生命周期（#94）、设置分组 / Launch at Login / 服务预设（#95）。
- 不开放 freshness 分钟数、刷新间隔、估值开关。
- 不改 Grok 池估值的 10 分钟门。
- 不改后端 weekly 估算公式、官方 used% 计算、tray 百分比语义。
- 不把 pace 耗尽倒计时也做成 last-known 展示。

## Behavior Invariants

1. `B-001` 官方 weekly used% ≥ 100 且已连接时，header 状态为 `Weekly exhausted`（不是只写 Connected）；倒计时 / 重置时刻仍用官方 `resetsAt`。
2. `B-002` 打满且存在 `available` bonus credit 时，Bonus 卡上移到 usage 卡之后、估值 / Tip / timeline / cost 之前；卡内主行动打开现有 Codex dashboard（`open_codex_dashboard`），并写明 QuotaBar 不能代为核销。
3. `B-003` 打满且无 available bonus 时，不画空 Bonus 卡；Tip / 状态条只给等待文案。
4. `B-004` weekly value 仅因观察时间超过 10 分钟失败，且 `resetsAt`、`usedPct` 仍与官方周窗口对齐时，必须显示数字，并标 `Last estimate` 与观察多久之前；不得出现 `Weekly value unavailable`。
5. `B-005` 无效总额、用量差 > 5%、重置不对齐、未来 / 无法解析的 `observedAt` 仍整卡隐藏（硬拒绝）。不得把上一周或另一水位的金额留下来。
6. `B-006` Local pace 在打满后不展示投影；pace / value 若只是本机快照停更，合并为一条次级说明，不渲染 `The local …` 校验原文。
7. `B-007` 官方 weekly ≥ 100 时，Tip 不得再写 `Codex Weekly is at 100%.`。有券：`Weekly is used up. Wait until {reset}, or use 1 bonus reset.`（count 跟随 available 数）。无券：`Weekly is used up. Resets {reset}.` 未打满时 `getHighUsageTip` 行为不变。
8. `B-008` 官方 limits 成功后，Codex 面板展示 `Updated …`（just now / Nm ago / …）。仅本地 extras 过期时，Refresh 不得假装能造出 CLI 快照；完成后官方仍新则保持 `Quota current`，extras 继续用 B-006 那条说明。
9. `B-009` 官方 100% 红条、重置倒计时、Bonus 可用数量、tray `usedPercent` 不被本地 extras 失败改写。页脚 Dashboard 文案保持 `Dashboard`。
10. `B-010` 窗口切到下一周（官方 `resetsAt` 不再与估值对齐）后，旧估值必须消失。

## Acceptance Criteria

- 复现夹具：官方 weekly 100%、本地 quota `observedAt` 31 分钟前、value estimate 同源时间戳且 used/reset 对齐、1 张 available bonus。结果：红条 100% 仍在；估值卡可见且带 Last estimate；无 `Weekly value unavailable` / `Local pace unavailable` 原文；Bonus 在 Tip 之上且可点；Tip 为决策句；header 为 Weekly exhausted。
- 估值硬拒绝矩阵保持隐藏：invalid totals、usedPct 漂移、reset 漂移、future/NaN `observedAt`。
- 未打满、估值新鲜时，现有 API-equivalent week 卡不变。
- Bonus 主行动调用现有 dashboard opener exactly once；失败走现有 toast，不新增 command。
- Claude / Cursor / Grok 的 80% Tip 与 Grok 估值隐藏行为有回归断言。
- 官方周窗口切到新 `resetsAt` 后，旧估值不得出现。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| 100% + 同窗口过期估值 + 1 bonus | 显示估值 + Bonus CTA + 决策 Tip |
| 100% + 无 bonus | 无 Bonus 卡；等待 Tip |
| 40% + 新鲜估值 | 现有估值卡，无 exhausted 层级 |
| 40% + 仅过期估值、窗口对齐 | Last estimate，非 unavailable |
| 估值 reset 对不上 | 隐藏估值 |
| 打满 + pace 过期 | 不画 pace 投影；一条合并说明 |
| Refresh 且官方已新 | 不出现假 Loading 失败感；Quota current |
| 下一周 | 旧 $ 消失 |
| Dashboard opener 失败 | 现有 toast；面板数字不动 |

## Open Questions

- 无。核销仍在 ChatGPT；dashboard URL 沿用现有 `https://chatgpt.com`，本 issue 不改 opener 目标。

# GH-95 Product Spec：设置控制面（预设与分组）

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/95
- `complexity: medium`
- Analysis: `docs/product/codex-exhausted-and-settings-analysis.md`
- Depends: #94 合入后再改 Notifications 分组，以免和五行 key 冲突。不依赖 #93 的面板层级。

## Problem

设置回答「看起来怎样」，不回答「我只用 Codex」。Panel / Menu 矩阵正确但难懂。预算和通知挤在一组。Recent events 不能点回对应 provider。Launch at Login 缺失，但本仓库还没有 autostart 插件。

## Goals

- 在现有矩阵之上提供一键预设：All / 单个已支持服务。
- 把 Budgets 与 Notifications 分成两个 settings group。
- Recent events 可点回匹配的 provider 面板。
- 保持「至少一 panel、至少一 tray」的既有 guard（GH-61）。

## Non-Goals

- 不做独立 Settings 窗口。
- 不开放刷新间隔 / Adaptive / freshness 滑条。
- 不做 provider source-mode、cookies、OAuth picker。
- **本 issue 不做 Launch at Login。** 需要 `tauri-plugin-autostart` 与开机权限，另开 follow-up，避免本 PR 引入新 native dependency。
- 不改通知 key 语义（那是 #94）。
- 不改 tray guard 文案或 switcher guard 文案。

## Behavior Invariants

1. `B-001` Providers 组顶部增加预设：`All`，以及 `Claude` / `Codex` / `Cursor` / `Grok` / `Antigravity` 各一。点 `All`：五个 Panel 全开；tray 保持用户当前 tray 开关（不强制全开）。点单一服务：该服务 Panel 开、其它 Panel 关；该服务 Menu/tray 开；其它 tray 保持不变，除非会违反「至少一个 tray」——不得把最后一个 tray 关掉。
2. `B-002` 预设走与手动开关同一套 persistence / guard。关到只剩一个 panel 时，矩阵里最后一个 panel 开关仍 disabled（现有 `panelLocked`）。预设不会产生非法「零 panel」状态。
3. `B-003` Settings 出现两个 group：`Limits`（月预算，现有输入）与 `Alerts`（`NOTIFICATION_ROWS`，含 #94 的行）。编号顺延，不删 Appearance / Providers / Panel content / Activity。
4. `B-004` Recent events 里文本能解析出 provider label（`Claude` / `Codex` / `Cursor` / `Grok` / `Antigravity`）的行是按钮；点击关闭 Settings 并切到该 provider tab。解析不到的行保持只读。
5. `B-005` Hide Dock、theme、tray style、cycle、panel sections 行为不变。
6. `B-006` 不新增 Tauri plugin、不改 storage key 名字（仍可用 `claude-quota-*`）。预设不单独持久化；只是写现有 switcher / tray bits。

## Acceptance Criteria

- 点 Codex only：switcher 仅 Codex true；Codex tray true；其它 panel false；其它 tray 若原先是唯一开启的非 Codex tray，不得被关到零 tray（保留至少一个 tray，优先保留 Codex）。
- 点 All：五 panel true；tray 集合与点击前相比，Codex-only 用户再点 All 只恢复 panel，不擅自打开用户关过的 tray。
- StrictMode 下预设 persistence 次数与 GH-61 一样：每次 accepted 预设各相关 save exactly once per store，不在 updater 里 save。
- Budgets 与 Notifications 不在同一个 `settings-group` DOM 里。
- `Codex usage crossed 95%` 事件可点，回到 Codex 面板且 Settings 关闭。
- `Failed to persist local setting.` 这类无 provider 的事件不可点。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| Codex only | 一 panel；Codex tray on；零 panel 不可能 |
| All | 五 panel；不强制打开已关 tray |
| 只剩一个 tray 且不是目标服务 | 不得关到零 tray；目标 tray 打开 |
| GH-61 only-visible panel disable | 仍 blocked + toast |
| event 带 Codex | 切 Codex，关 Settings |
| event 无 label | 只读 |
| Launch at Login | 本 issue 不出现该行 |

## Open Questions

- Launch at Login 的 follow-up issue 在本 PR 合入后另开，不阻塞 #95。

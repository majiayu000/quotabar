# GH-95 Tech Spec：presets 与 settings 分组

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/95
- Product spec: `specs/GH95/product.md`

## Current Mechanism

`SettingsView` 五组。Providers 是 Panel/Menu 矩阵，`handleSwitcherToggle` / `handleTrayToggle` 已按 GH-61 用 render snapshot 决策，禁止在 functional updater 里 persist。

Notifications 与 budgets 同在 group 04。Events 是只读 6 行。无 autostart 依赖。

## Proposed Design

### 1. Presets

在 `App` 增加 `applyProviderPreset(preset: 'all' | TrayServiceName)`：

- `all`：`nextSwitcher =` 所有 service true；`saveSwitcherVisibility` once；不改 tray map。
- service：`nextSwitcher` 仅该 service true；若该服务 tray 未开则打开并 `saveTrayEnabled`；其它 tray 不关，除非当前 enabled tray 集合在「不打开目标」时为空——此时必须打开目标 tray，其它可保持。

决策与 persist 放在 handler 里，不放进 `setState(updater)`。测试用真实 Settings 回调或抽纯函数 `planProviderPreset(currentSwitcher, currentTrays, preset)`，**推荐抽纯函数** 以便单测非法态，但仍由 App handler 调 save，避免复制 GH-61 的 side-effect 错误。

Settings UI：矩阵上方一排 `settings-seg` 按钮，label `All` / 各 `SERVICE_META.shortLabel`。

### 2. Group split

`SettingsView` 把 group 04 拆成：

- Limits：月预算 + 现有 hint
- Alerts：`NOTIFICATION_ROWS`

Activity 仍是 events + Dock。组标题 index 重排为 01–06。

### 3. Clickable events

`event.text` 用 `SERVICE_META[service].label` 做 prefix / includes 匹配，先匹配最长 label，避免将来短名冲突。命中则渲染 button，`onSelectProvider(service)`：`saveSettingsExpanded(false)` + `setAndPersistTab(service)`。

### 4. Tests

- `planProviderPreset` 或 real-App：All、Codex only、只剩 Cursor tray 时点 Codex only（Cursor tray 可留、Codex tray 开，零 tray 不可能）。
- Settings DOM：两个 group heading `Limits` / `Alerts`。
- event 行：Codex 文案可点；无 label 不可点。
- GH-61 既有 switcher 测试继续绿。

## Affected Files / Allowlist

- `src/App.tsx`
- `src/components/SettingsView.tsx`
- `src/services/switcher_providers.ts` 或新建 `src/services/provider_presets.ts`（纯函数）
- `src/redesign-settings.css` 仅当预设行需要既有 seg 样式的最小补充
- `tests/provider_presets.test.ts`
- `tests/settings_events_navigation.test.tsx` 或扩展现有 settings / switcher tests
- `specs/GH95/tasks.md`

禁止：`src-tauri/**`、新 Cargo 依赖、通知 key 改名、CodexPanel 布局。

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| 预设关光 tray | 纯函数断言 enabled tray ≥ 1 |
| updater 里 save | 与 GH-61 相同：handler 内 snapshot + exact once |
| 与 #94 五行冲突 | 本 PR 基于已含 #94 的 main，只搬 DOM 分组 |
| All 打开用户关过的 tray | B-001：All 不改 tray |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` `B-002` | preset matrix + tray cardinality |
| `B-003` | two groups |
| `B-004` | event click / non-click |
| `B-005` `B-006` | 无新 key / 无 plugin |

## Test Plan

```bash
set -euo pipefail
npx tsc --noEmit
npx vitest run tests/provider_presets.test.ts tests/switcher_visibility_transactions.test.tsx
npm test
npm run build
```

## Rollback Plan

回滚 implementation PR。switcher / tray storage 格式不变。无 migration。

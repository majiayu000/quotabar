# GH-94 Tech Spec：notification keys 与跨越检测

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/94
- Product spec: `specs/GH94/product.md`

## Current Mechanism

`NotificationKey = 'q80' | 'q95' | 'bonus'`。`getSavedNotificationSettings` 对未知 / 缺失 key 保留 `defaultNotificationSettings()` 里的值，因此加 key 并写入 defaults 即可兼容旧 JSON。

`useServiceEvents` 在 `before.used < 95 && after.used >= 95` 与 else-if 80 上 log + 条件 notify。没有 100 档。

`App.handleBonusExpiring` 只处理过期。`CodexPanel` 已计算 `availableResetCredits`，但只回调 `onBonusExpiring(daysLeft)`。

## Proposed Design

### 1. Schema

```ts
export type NotificationKey = 'q80' | 'q95' | 'q100' | 'bonusReady' | 'bonus';
```

`defaultNotificationSettings()` 五档 true。`NOTIFICATION_ROWS` 按 product 顺序。`getSavedNotificationSettings` 循环 `NOTIFICATION_ROWS` 的既有逻辑自动给缺失 key 留下 default。

更新所有构造 `NotificationSettings` 的测试夹具，补上新 key，避免多余属性检查失败。

### 2. 100% 跨越

在 `useServiceEvents` 的 used 比较里，**独立于** 80/95 的 if/else：

```ts
if (before.used < 100 && after.used >= 100) {
  logEvent('critical', `${label} usage reached 100%`);
  if (notifSettings.q100) void notify('QuotaBar', `${label} usage reached 100%`, opts);
}
```

95 分支保持原样。同一次 effect 可以先走 95 再走 100。

### 3. bonusReady

不要把 reset-credit 列表塞进 `useServiceEvents`（它现在只吃 used%）。在 `App` 增加窄回调，由 `CodexPanel` 在算完 `availableResetCredits` 与官方 weekly 后调用，例如：

`onBonusReadyChange?(ready: { exhausted: boolean; availableCount: number })`

`App` 用 ref 记住上一拍 `{ exhausted, availableCount }`：

- `exhausted && availableCount > 0` 且上一拍不满足该合取 → 触发 bonusReady log/notify
- 进入条件包括：`!prev.exhausted && exhausted && count>0`，或 `exhausted && prev.count===0 && count>0`

body：`Codex weekly is at 100%. ${n} bonus reset${n === 1 ? '' : 's'} available.`

n=1 产品句是 `1 bonus reset available`（单数）。

首次 mount 的上一拍为 null：不把「打开 app 时已经 100% 且有券」当成跨越（与 `useServiceEvents` 对 used% 的 `if (!prev) return` 一致）。若产品以后要「启动补发」，另开 issue。

### 4. Settings

`SettingsView` 已 map `NOTIFICATION_ROWS`，无需新 UI 组件。label 锁在 `NOTIFICATION_ROWS`。

### 5. Tests

- `tests/notifications.test.ts`：defaults 五 key；旧三 key JSON 读出新 key true；round-trip 含新 key。
- `tests/service_events.test.ts`（新建或扩展现有）：99→100、95 与 100 同帧、关 q100、Claude 无 bonusReady。
- App/Codex 回调测试：0→1 credit 于已 100%；99→100 同时有券；refresh 稳定态不重复。
- 夹具 `notificationSettings={{ q80, q95, bonus }}` 全部补全。

保持 GH-48 AST / helper 约定：每个 notify 第三参是 `createNotificationFailureOptions(logEvent)`。

## Affected Files / Allowlist

- `src/services/notifications.ts`
- `src/hooks/use_service_events.ts`
- `src/App.tsx`（bonusReady 上一拍 + 开关）
- `src/components/CodexPanel.tsx`（只加 ready 回调，不改 #93 布局）
- `tests/notifications.test.ts`
- `tests/service_events.test.ts` 或现有 events 测试
- `tests/storage_write_failures.test.ts`
- `tests/storage_read_failures.test.ts`
- `tests/panel_shell_ui.test.tsx`
- 其它因 `NotificationSettings` 缺字段而必须补 key 的测试夹具
- `specs/GH94/tasks.md`

若 #93 尚未合入，`CodexPanel` 回调加在现有 Bonus 计算旁，不要顺手改层级。

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| 打开 app 就推 100% | 与 used% 一样，无 prev 不发 |
| 12h 内 refresh 刷屏 | body 固定 + 现有 dedupe |
| 95 被 100 吃掉 | 100 独立 if，测试同帧两者 |
| Settings 夹具漏 key | 全仓搜 `q80:` 补全 |
| 做成 #93 的面板 PR | allowlist 禁止 exhausted 层级 / Tip / 估值改动 |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` | defaults + old JSON |
| `B-002` | 99→100 各 provider |
| `B-003` | Codex 合取矩阵 |
| `B-004` | bonus expiry 文案/入口不变 |
| `B-005` | 同帧 95+100 |
| `B-006` | helper 第三参 |
| `B-007` | rows label + 开关关仍 log |

## Test Plan

```bash
set -euo pipefail
npx tsc --noEmit
npx vitest run tests/notifications.test.ts tests/storage_read_failures.test.ts tests/storage_write_failures.test.ts
npm test
npm run build
```

## Rollback Plan

回滚 implementation PR。旧三 key JSON 仍合法。用户在新版本关掉的 `q100` / `bonusReady` 回滚后 key 被忽略。

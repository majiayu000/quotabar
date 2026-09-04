# GH-94 Product Spec：打满与「有券却被挡住」通知

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/94
- `complexity: medium`
- Analysis: `docs/product/codex-exhausted-and-settings-analysis.md`
- Upstream language: #93（面板文案）。本 issue 不改面板布局。
- Follow-up: #95 只做设置分组，不改本 issue 的 key 语义。

## Problem

通知停在 used% 跨越 80 / 95，以及 Bonus 三天内过期。跨越 100%、或已经 100% 且手里还有 unused gifted reset，系统不响。80→95 已经吵过，到不可用反而静音。

现有 key：`q80` / `q95` / `bonus`。12 小时按 **body 文本** 去重，成功送达后才 commit（GH-48）。

## Goals

- 补齐告警生命周期的两端：Exhausted，以及「打满且有未用券」。
- 新档默认开，旧档语义、阈值、12 小时去重、failure-options helper 不变。
- Settings 里能关掉新档；缺省 key 视为 true（与现有未知 key 兼容方式一致）。
- 不在通知里核销、不深链进 ChatGPT（点通知仍只是系统通知；打开 app 是 OS 行为）。

## Non-Goals

- 不改 Codex 面板层级、估值、Tip（#93）。
- 不按 provider / 窗口自定义百分比。
- 不新增 100% 以外的阈值（例如 99）。
- 不改 12 小时窗口、标题 `QuotaBar`、dedupe 实现。
- 不做 Launch at Login、设置重排（#95）。

## Behavior Invariants

1. `B-001` `NotificationKey` 增加 `q100` 与 `bonusReady`。`NOTIFICATION_ROWS` 顺序：80 → 95 → 100 → bonus ready → bonus expiry。默认五档均为 `true`。旧 storage 只有三 key 时，两档新 key 读成 `true`。
2. `B-002` 任一 provider 的 tray used% 从 `< 100` 跨越到 `≥ 100` 时，若 `q100` 开：event `critical` + 通知 body 固定为 `{Label} usage reached 100%`。未跨越（刷新仍是 100%）不重复（除 12 小时窗口过期后的正常再评）。
3. `B-003` Codex 在「官方 weekly used% ≥ 100」且 `getAvailableResetCredits` 长度从 0 变为 > 0，或 used% 跨越 100 的同时已有 available credit：若 `bonusReady` 开，event `warning` + 通知 body 固定为 `Codex weekly is at 100%. {n} bonus reset available.`（n 为 available 数，1 时用单数 reset）。其它 provider 不发 `bonusReady`。
4. `B-004` `bonus`（过期提醒）继续只由现有 `onBonusExpiring` / 3 天窗口触发，文案不变。不得用 `bonusReady` 取代它。
5. `B-005` `q80` / `q95` 跨越逻辑、body、level 保持精确不变。一次刷新同时跨 80 与 95 时仍只发 95（现有 if/else）。一次刷新同时跨 95 与 100 时：先保持现有 95 分支，**另发** 100（100 不是 95 的 else）。测试锁顺序：95 的 log/notify 仍发生，100 随后发生。
6. `B-006` 所有新 notify callsite 第三参数必须是 `createNotificationFailureOptions(logEvent)`。body 为固定模板，不含 email、token、路径。
7. `B-007` Settings 用现有 toggle 行渲染新档，label 固定：`Alert at 100% used`、`Alert when a bonus reset is unused at 100%`。关 `q100` / `bonusReady` 后对应跨越零通知，仍写 event feed（与现有 80/95 一致：现有是关了就不 notify，但仍 `logEvent`——保持同一模式：log 始终写，notify 看开关）。

核对现有 80/95：log 始终写，notify 看开关。100 / bonusReady 必须相同。

## Acceptance Criteria

- 默认设置对象含五 key 全 true；只存了 `{q80,q95,bonus}` 的旧 JSON 读出来两新 key 为 true。
- Codex used 99 → 100、无 bonus：一条 100% 通知，零 `bonusReady`。
- Codex used 99 → 100、已有 1 available：100% 通知 + `Codex weekly is at 100%. 1 bonus reset available.`
- Codex 已 100%、credits 从 0 张变为 1 张：只发 `bonusReady`，不因「仍是 100」再发 q100。
- Codex 已 100%、credits 保持 1 张、反复 refresh：两档都不因同 body 在 12 小时内再送。
- Claude 99 → 100：只有 `{Claude} usage reached 100%`，零 bonusReady。
- 关 q100：跨越仍有 critical event，无 notify。
- Settings 五行 label exact。
- GH-48 delivery-first dedupe 与 failure helper 不被绕过。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| 旧三 key storage | 新 key default true |
| 99→100 无券 | q100 only |
| 99→100 有券 | q100 + bonusReady |
| 已 100 后才到券 | bonusReady only |
| 已 100 且券不变 | 不因 refresh 再送 |
| 95 与 100 同帧 | 95 仍发，100 另发 |
| 非 Codex | 无 bonusReady |
| 开关关 | log 在，notify 不在 |
| body 去重 | 12h，成功后才 commit |

## Open Questions

- 无。通知不承担打开面板；#93 负责点开后的首屏。

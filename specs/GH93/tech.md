# GH-93 Tech Spec：Codex exhausted layout 与 weekly value 软降级

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/93
- Product spec: `specs/GH93/product.md`

## Current Mechanism

`CodexPanel` 把官方 limits 与 `get_codex_weekly_quota` 分开拉。官方 100% 照常渲染。本地 `validateWeeklyQuotaWindow` / `validateWeeklyValueEstimate` 把任何失败（含年龄）变成 `displayed* = null` + 校验原文。

年龄门：

- pace：`now - observedAt > 30min`
- value：`now - observedAt > 10min`，或未来超过 5min，或 NaN

`getHighUsageTip` 只复读最高窗口百分比。Bonus 卡在 Tip 之后，无 click handler。`open_codex_dashboard` 已存在，打开 `https://chatgpt.com`。

## Proposed Design

### 1. 拆硬拒绝 / 软降级

保持两道校验函数，但返回结构化结果，而不是只返回 string：

```ts
type EstimateCheck =
  | { ok: true }
  | { ok: false; kind: 'hard' | 'soft'; message: string };
```

value **soft** 仅当：totals 合法、`usedPct` 与官方差 ≤ 5%、`resetsAt` 与官方差 ≤ 5min、`observedAt` 可解析且不在未来，只是年龄 > 10min。

其它失败为 **hard**。soft 时 `displayedWeeklyValueEstimate` 仍为 estimate 对象，UI 走 Last estimate；hard 时保持现在的隐藏。

pace：打满（官方 weekly ≥ 100）时不调用 pace 投影、不渲染 `Local pace unavailable: …`。未打满时 pace 硬失败仍可一条合并说明，但不画误导性耗尽倒计时。

### 2. 合并本地 extras 文案

当 pace 或 value 存在 soft/age 失败时，只渲染一行次级 copy，例如：

`Local extras paused · Codex CLI has not refreshed in 47m`

分钟数取更旧的那份 `observedAt`。禁止把 `The local weekly value estimate is stale or has an invalid observation time.` 等函数返回值直接进 JSX。

### 3. Exhausted 层级

当 `selectOfficialWeeklyLimitWindow` 的 `usedPercent >= 100`：

1. Usage 卡（官方红条 + 倒计时）
2. Bonus 卡（仅 `getAvailableResetCredits` 非空）
3. Weekly value（soft 或新鲜）
4. 合并 extras 说明（如有）
5. Tip（`getExhaustedWeekTip`，不是 `getHighUsageTip`）
6. Timeline / cost 维持 `sections.*`

header `status`：`Weekly exhausted`；`tone` 用现有 `error` 或 `pending` 中能与 Connected 绿灯区分的值。未打满不走这套顺序。

### 4. Bonus CTA

Bonus 卡（header 或整卡）是 `<button>`，`onClick` 调 `onOpenDashboard`。`App` 把现有 `handleOpenDashboard` 传给 `CodexPanel`。不新增 Tauri command，不改 `link::open_codex_dashboard` URL。

卡上加一句固定说明：`Opens ChatGPT. QuotaBar cannot apply this reset.`

### 5. Tip

在 `detail_helpers.ts` 新增 `getExhaustedWeekTip({ resetLabel, bonusCount })`。`getHighUsageTip` 签名与阈值不变；Codex 打满时不用它。其它 provider 继续只用 `getHighUsageTip`。

`resetLabel` 复用现有 `formatResetAt` / `formatResetTime` 之一，测试锁固定字符串。

### 6. Last updated 与 Refresh 反馈

`CodexPanel` 在官方 `getCodexRateLimits` 成功且无 `limits.error` 时记录 `officialUpdatedAt = Date.now()`。展示 `Updated just now`（< 15s）或 `Updated {n}m ago`。

`loading` 仍由 current generation 控制（GH-52）。若本次成功刷新后官方 weekly 与刷新前相同，且本地 extras 仍 soft-stale，不得另起 error banner。可用一句 `Quota current` 贴在 last updated 旁。

### 7. Tests

扩展 `tests/provider_refresh_races.test.tsx` 的 stale observation 例：从「隐藏 + unavailable 原文」改为「Last estimate + 无 unavailable 原文」。

新增 `tests/codex_exhausted_panel.test.tsx`（或同文件 describe）：

- 100% + stale same-window value + 1 bonus：顺序、CTA、Tip、header
- 100% + 0 bonus：无 Bonus 卡、等待 Tip
- hard reject 矩阵
- 未打满 + 新鲜估值回归
- reset 漂移后旧估值消失
- `getHighUsageTip` 在 Claude 80% 仍为旧句
- dashboard callback 点击一次

## Affected Files / Allowlist

- `src/components/CodexPanel.tsx`
- `src/services/detail_helpers.ts`
- `src/App.tsx`（仅传入 `onOpenDashboard`）
- `src/styles/content.css` 或现行 Codex/bonus 样式所在 stylesheet（只为 CTA / Last estimate 必要 class）
- `tests/provider_refresh_races.test.tsx`
- `tests/detail_helpers.test.ts`
- `tests/codex_exhausted_panel.test.tsx`
- `specs/GH93/tasks.md`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| 把上一周 $ 留下 | B-005 / B-010：reset 不对齐必 hard |
| 点击 Bonus 被当成已核销 | 固定 cannot-apply copy；只调用现有 opener |
| 改坏其它 provider Tip | Codex 打满走新 helper；旧 helper 回归 |
| App.tsx 范围膨胀 | 只加一个 optional callback prop |
| 校验原文又漏进 UI | 测试断言不含 `The local weekly` / `The local pace snapshot` |
| GH-52 generation 被破坏 | 不改 request coordinator；只在 current success 写 `officialUpdatedAt` |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` | header 文案 + tone |
| `B-002` `B-003` | Bonus 顺序 / 有无 / click count |
| `B-004` `B-005` `B-010` | soft vs hard value matrix |
| `B-006` | 无校验原文；打满无 pace 投影 |
| `B-007` | exhausted tip + Claude tip 回归 |
| `B-008` | last updated；refresh 后无 error banner |
| `B-009` | 官方 100% 与 footer Dashboard 文案不变 |

## Test Plan

```bash
set -euo pipefail
npx tsc --noEmit
npx vitest run tests/provider_refresh_races.test.tsx tests/detail_helpers.test.ts tests/codex_exhausted_panel.test.tsx
npm test
npm run build
```

Rust 不在本 issue 的必跑变更集里。若 `src-tauri` 被误改，PR 必须先撤回再合。

## Rollback Plan

回滚 implementation PR。无 storage schema、无 backend payload、无新 dependency。旧行为恢复为：过期估值隐藏、Bonus 不可点、Tip 复读 100%。

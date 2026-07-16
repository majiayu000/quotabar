# GH-35 Tech Spec：显式处理 localStorage 写入失败

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/35
- Product spec: `specs/GH35/product.md`

## Current Behavior

`src/services/` 的 9 个写入口和 `src/App.tsx` 的 6 次直接写入都用空 `catch` 吞掉 `localStorage.setItem` 异常。service 保存函数返回 `void`，调用方无法区分已保存与未保存；`shouldNotify` 即使 dedupe 写失败也返回 `true`。

## Codebase Context

| 当前区域 | 当前职责 | 设计决定 |
| --- | --- | --- |
| `src/services/tray_style.ts`, `tray_visibility.ts`, `switcher_providers.ts`, `panel_sections.ts`, `budget.ts`, `notifications.ts` | 保存用户设置 | 改为调用统一 adapter，并返回 `boolean`。 |
| `src/services/event_log.ts` | 保存 recent events | 调用 adapter；失败仍返回本会话列表，由 adapter 输出 `console.error`。 |
| `src/services/notifications.ts` | 保存 notification dedupe | adapter 返回失败时 `shouldNotify` 返回 `false`。 |
| `src/services/app_state.ts` | 初始化时修复全关闭 tray 状态 | 检查 `saveTrayEnabled` 返回值；失败保留本会话默认并依赖 adapter 输出 error 证据。 |
| `src/App.tsx` | 保存 tab/theme/dock/settings 状态并拥有全局 toast | 移除直接 `setItem`；检查失败结果并显示统一提示。 |
| `src/components/SettingsView.tsx` | 保存 monthly budgets | 通过 callback 把失败交给 App 的统一 toast。 |
| tests | 仅覆盖内存 storage 成功写入 | 新增抛错 storage 矩阵和 adapter coverage。 |

## Proposed Design

### 1. 单一 write adapter

新增 `src/services/storage.ts`：

- 导出 `STORAGE_WRITE_FAILURE_MESSAGE`，文案明确表示变化只在当前会话生效且未保存。
- 导出 `writeStorageItem(key: string, value: string): boolean`。
- 成功调用 `localStorage.setItem` 并返回 `true`。
- 捕获 `unknown` 异常后执行 `console.error("Failed to persist local setting:", error)` 并返回 `false`；不记录 key 或 value，避免把潜在数据写入日志。

### 2. service 返回显式结果

所有设置 saver 改为返回 adapter 的 `boolean`。既有成功调用方行为不变；App 和 SettingsView 必须检查返回值。`recordEvent` 继续返回 `AppEvent[]`，但调用 adapter 后的失败由 adapter 以 error 级暴露。

`shouldNotify` 在 dedupe 写失败时返回 `false`。这样 `notify` 现有的 `if (!shouldNotify(body)) return` 会自然 fail closed，不需要新增发送分支。

### 3. 用户可见失败提示

App 提供单一 `showStorageWriteFailure` callback，设置统一 toast 并复用现有 toast timeout。用户选择仍更新当前 React state，提示准确说明本会话已应用但未保存。

SettingsView 新增 `onStorageWriteFailure: () => void` prop，仅在 budget saver 返回 `false` 时调用。其他设置 handler 在 App 内直接检查 saver/adapter 返回值。

### 4. 测试与覆盖率

新增 `tests/storage_write_failures.test.ts`：

- memory storage 证明 adapter 成功返回 `true`。
- throwing storage 证明 adapter 返回 `false` 且调用 `console.error`。
- throwing storage 表驱动覆盖全部 9 个 service 写入口。
- 单独断言 `shouldNotify` 返回 `false`，`recordEvent` 仍返回本会话事件。

为 Vitest 增加与现有版本一致的 `@vitest/coverage-v8@4.1.6`，只对新增 adapter 执行 100% lines/functions/branches/statements threshold；其余 wiring 由表驱动失败测试、TypeScript build 和静态调用检查覆盖。

## Affected Files / Allowlist

- `package.json`
- `package-lock.json`
- `src/services/storage.ts`
- `src/services/app_state.ts`
- `src/services/budget.ts`
- `src/services/event_log.ts`
- `src/services/notifications.ts`
- `src/services/panel_sections.ts`
- `src/services/switcher_providers.ts`
- `src/services/tray_style.ts`
- `src/services/tray_visibility.ts`
- `src/App.tsx`
- `src/components/SettingsView.tsx`
- `tests/storage_write_failures.test.ts`
- `specs/GH35/tasks.md`

## Compatibility

- localStorage keys 与 JSON/string 格式保持不变，无迁移。
- 成功写入时 UI、event log 与 notification 行为保持不变。
- 保存函数从 `void` 改为 `boolean`；这些是仓库内部函数，所有仓库调用点在同一 implementation PR 中迁移，不保留 alias。
- 失败提示是新的必要可见行为，不隐藏、不自动重试。

## Risks and Mitigations

| 风险 | 缓解措施 |
| --- | --- |
| 漏迁某个直接写点，继续静默失败 | 要求 `localStorage.setItem` 仅在 adapter 出现，并用 `rg` 精确检查。 |
| saver 返回值被调用方忽略 | 表驱动测试覆盖 service 契约；对 App/SettingsView diff 做 SpecRail review，静态搜索全部 saver 调用点。 |
| notification dedupe 失败后仍发送 | 专门测试 `shouldNotify === false`，并保留 `notify` 现有 early return。 |
| toast 误称设置完全失败 | 固定文案说明“当前会话已应用、未保存”。 |
| 日志泄漏 storage key/value | adapter 只记录固定文案与原异常，不记录 key/value。 |
| coverage 依赖版本漂移 | 锁定与 `vitest@4.1.6` 相同版本并提交 lockfile。 |
| 与其他工作冲突 | implementation 从 spec 合并后的最新 `origin/main` 创建；精确 allowlist，排除 PR #31 与读取策略。 |

## Product-to-Test Mapping

| Behavior invariant | Implementation area | Verification |
| --- | --- | --- |
| `B-001` 成功行为兼容 | adapter、全部 saver、现有 storage tests | `npm test`; existing round-trip tests |
| `B-002` 设置失败提示准确 | `App.tsx`, `SettingsView.tsx`, saver boolean results | TypeScript build；调用点静态检查；独立 reviewer |
| `B-003` notification fail closed | `notifications.ts` | throwing storage 下 `shouldNotify` 返回 `false` |
| `B-004` event log error 暴露 | `event_log.ts`, adapter | throwing storage 下返回事件且 `console.error` 被调用 |
| `B-005` 单一写入口 | `storage.ts` 与全部迁移点 | `matches=$(rg -l "localStorage\\.setItem" src); test "$matches" = "src/services/storage.ts"` |
| `B-006` 完整证据 | tests、coverage、CI | 完整 Test Plan |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)package.json' \
  ':(exclude)package-lock.json' \
  ':(exclude)src/services/storage.ts' \
  ':(exclude)src/services/app_state.ts' \
  ':(exclude)src/services/budget.ts' \
  ':(exclude)src/services/event_log.ts' \
  ':(exclude)src/services/notifications.ts' \
  ':(exclude)src/services/panel_sections.ts' \
  ':(exclude)src/services/switcher_providers.ts' \
  ':(exclude)src/services/tray_style.ts' \
  ':(exclude)src/services/tray_visibility.ts' \
  ':(exclude)src/App.tsx' \
  ':(exclude)src/components/SettingsView.tsx' \
  ':(exclude)tests/storage_write_failures.test.ts' \
  ':(exclude)specs/GH35/tasks.md'
matches=$(rg -l "localStorage\.setItem" src)
test "$matches" = "src/services/storage.ts"
npm test
npm run build
npx vitest run tests/storage_write_failures.test.ts --coverage \
  --coverage.include=src/services/storage.ts \
  --coverage.reporter=text \
  --coverage.thresholds.lines=100 \
  --coverage.thresholds.functions=100 \
  --coverage.thresholds.branches=100 \
  --coverage.thresholds.statements=100
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Rollback Plan

回滚 implementation PR。由于 keys、格式和读取策略未改变，回滚不需要数据迁移，只会恢复旧的静默写失败行为。

# GH-35 Tech Spec：显式处理 localStorage 写入失败

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/35
- Product spec: `specs/GH35/product.md`

## Current Behavior

`src/services/` 的 9 个写入口和 `src/App.tsx` 的 6 次直接写入都用空 `catch` 吞掉 `localStorage.setItem` 异常。service 保存函数返回 `void`，调用方无法区分已保存与未保存；`shouldNotify` 即使 dedupe 写失败也返回 `true`。此外，budget cost consumers 与关闭 Settings 的 tab 恢复会重新从 storage 读取，单纯更新 React state 不能维持失败写入后的本会话选择。

## Codebase Context

| 当前区域 | 当前职责 | 设计决定 |
| --- | --- | --- |
| `src/services/tray_style.ts`, `tray_visibility.ts`, `switcher_providers.ts`, `panel_sections.ts`, `budget.ts`, `notifications.ts` | 保存/读取用户设置 | saver 调用统一 adapter 并返回 `boolean`；getter 先读取失败写入的 session shadow，再沿用原 catch/default。 |
| `src/services/event_log.ts` | 保存 recent events | 调用 adapter；失败仍返回本会话列表，由 adapter 输出 `console.error`。 |
| `src/services/notifications.ts` | 保存 notification dedupe | adapter 返回失败时 `shouldNotify` 返回 `false`。 |
| `src/services/app_state.ts` | 初始化时修复全关闭 tray 状态 | 检查 `saveTrayEnabled` 返回值；失败保留本会话默认并依赖 adapter 输出 error 证据。 |
| `src/App.tsx` | 保存 tab/theme/dock/settings 状态并拥有全局 toast | 移除直接 `setItem`；检查失败结果并显示统一提示。 |
| `src/components/SettingsView.tsx` | 保存 monthly budgets | 通过 callback 把失败交给 App 的统一 toast。 |
| tests | 仅覆盖内存 storage 成功写入 | 新增抛错 storage 矩阵和 adapter coverage。 |

## Proposed Design

### 1. 单一 storage adapter 与失败写入 shadow

新增 `src/services/storage.ts`：

- 导出 `STORAGE_WRITE_FAILURE_MESSAGE`，文案明确表示变化只在当前会话生效且未保存。
- 导出 `writeStorageItem(key: string, value: string): boolean`。
- 导出 `readStorageItem(key: string): string | null`，它只负责优先返回失败写入的 session shadow；没有 shadow 时直接调用 `localStorage.getItem`，不捕获异常，因此现有 getter 的 catch/default 策略不变。
- 写入成功后清除该 key 的旧 shadow 并返回 `true`。
- 捕获 `unknown` 异常后把本次 value 保存到模块内 session shadow，执行 `console.error("Failed to persist local setting:", error)` 并返回 `false`；不把 key 或 value 写入日志。
- 后续成功写入必须清除 shadow，避免旧的失败值覆盖已持久化新值。

### 2. service 返回显式结果

所有设置 saver 改为返回 adapter 的 `boolean`。既有成功调用方行为不变；App 和 SettingsView 必须检查返回值。现有 storage getters 改用 `readStorageItem`，但保留各自当前的解析、验证、catch 和 default，从而让 budget consumers、`getSavedTab()` 与其他本会话 reread 看见失败写入的最新值。

`recordEvent` 继续返回 `AppEvent[]`，失败写入也进入 shadow，因此 `getSavedEvents` 在本会话可读回该事件；adapter 同时以 error 级暴露失败。

`shouldNotify` 在 dedupe 写失败时返回 `false`。这样 `notify` 现有的 `if (!shouldNotify(body)) return` 会自然 fail closed，不需要新增发送分支。

### 3. 用户可见失败提示

App 提供单一 `showStorageWriteFailure` callback，设置统一 toast 并复用现有 toast timeout。用户选择仍更新当前 React state；后续 getter 通过 session shadow 看到同一选择，提示准确说明本会话已应用但未保存。

SettingsView 新增 `onStorageWriteFailure: () => void` prop，仅在 budget saver 返回 `false` 时调用。其他设置 handler 在 App 内直接检查 saver/adapter 返回值。

### 4. 测试与覆盖率

新增 `tests/storage_write_failures.test.ts`：

- memory storage 证明 adapter 成功返回 `true`。
- throwing storage 证明 adapter 返回 `false`、调用 `console.error` 且 `readStorageItem` 返回 session shadow。
- 失败后再次成功写入，证明旧 shadow 被清除并读取持久化新值。
- throwing storage 表驱动覆盖全部 9 个 service 写入口。
- 单独断言 `shouldNotify` 返回 `false`、`recordEvent` 可在本会话读回、budget getter 与 `getSavedTab()` 返回失败写入的新值。

为 Vitest 增加与现有版本一致的 `@vitest/coverage-v8@4.1.6`，输出全部 `src/**/*.{ts,tsx}` 的 LCOV。新增 `scripts/check_ts_diff_coverage.mjs`：

- 使用数组参数调用 `git diff --unified=0 --diff-filter=AM <base>...HEAD -- src`，解析新增行号，禁止 shell 字符串执行。
- 解析 LCOV `SF`/`DA`，只统计相对 base 的新增且可执行行；没有可计量新增行、缺 base、缺 LCOV、路径不匹配或解析错误均 fail closed。
- 全部新增 TS/TSX 可执行行阈值为 80%。
- `src/services/storage.ts`、`src/services/notifications.ts`、`src/services/event_log.ts` 的新增可执行行分别要求 100%，覆盖关键写失败、notification fail-closed 与 event-log error 路径。
- `scripts/check_ts_diff_coverage.test.mjs` 使用 Node 22 内建 test runner 覆盖 diff hunk、LCOV、阈值通过/失败与 malformed input；通过 `--experimental-test-coverage` 和 100% lines/functions/branches 阈值证明 checker 自身覆盖，不依赖未锁定包。

storage test 同时覆盖一个纯 `reportStorageWriteResult(persisted, onFailure)` helper：成功不调用 callback，失败调用一次。App/SettingsView 只把统一 toast callback 接到该 helper，减少不可测试 UI wiring；多个独立 `rg -q` 断言确保每个必要 symbol 与 app_state failure check 都存在，任一遗漏或搜索错误均失败。

## Affected Files / Allowlist

- `package.json`
- `package-lock.json`
- `scripts/check_ts_diff_coverage.mjs`
- `scripts/check_ts_diff_coverage.test.mjs`
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
| `B-002` 设置失败提示准确且本会话值稳定 | `App.tsx`, `SettingsView.tsx`, adapter shadow, budget/tab getters | throwing storage 下 budget/tab reread 与 failure callback 测试；分离的 wiring symbol 断言；独立 reviewer |
| `B-003` notification fail closed | `notifications.ts` | throwing storage 下 `shouldNotify` 返回 `false` |
| `B-004` event log error 暴露 | `event_log.ts`, adapter | throwing storage 下返回并读回本会话事件，且 `console.error` 被调用 |
| `B-005` 单一写入口 | `storage.ts` 与全部迁移点 | `matches=$(rg -l "localStorage\\.setItem" src); test "$matches" = "src/services/storage.ts"` |
| `B-006` 完整证据 | tests、LCOV diff checker、CI | 全部新增 TS/TSX 可执行行 ≥80%；storage/notifications/event_log 新增行各 100%；完整 Test Plan |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)package.json' \
  ':(exclude)package-lock.json' \
  ':(exclude)scripts/check_ts_diff_coverage.mjs' \
  ':(exclude)scripts/check_ts_diff_coverage.test.mjs' \
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
npx vitest run --coverage \
  --coverage.include='src/**/*.{ts,tsx}' \
  --coverage.reporter=lcov \
  --coverage.reporter=text
node --experimental-test-coverage \
  --test-coverage-include=scripts/check_ts_diff_coverage.mjs \
  --test-coverage-lines=100 \
  --test-coverage-functions=100 \
  --test-coverage-branches=100 \
  --test scripts/check_ts_diff_coverage.test.mjs
node scripts/check_ts_diff_coverage.mjs \
  --base origin/main \
  --lcov coverage/lcov.info \
  --minimum 80 \
  --critical src/services/storage.ts=100 \
  --critical src/services/notifications.ts=100 \
  --critical src/services/event_log.ts=100
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Rollback Plan

回滚 implementation PR。由于 keys、格式和读取失败/default 策略未改变，回滚不需要数据迁移，只会恢复旧的静默写失败行为。

# GH-38 Tech Spec：typed storage read 与启动期失败交付

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/38
- Product spec: `specs/GH38/product.md`

## Current Behavior

`src/services/storage.ts` 的 `readStorageItem` 返回 `string | null` 并允许 access error 抛给 service；13 个直接读取调用由各 service 的 12 个 catch 返回默认/空值，其中 6 个为空 catch。该结构无法区分 missing、访问失败与 decode failure。`loadNotified()` 将读取失败变成 `{}`，因此在写入仍可用时 `shouldNotify()` 会 fail open。

## Proposed Design

### 1. 单一 typed read contract

在 `src/services/storage.ts` 用以下 contract 替换 raw reader，不保留兼容 alias：

```ts
export type StorageReadResult<T> =
  | { status: 'missing' }
  | { status: 'value'; value: T }
  | { status: 'failure' };

export interface StorageReadOptions {
  notifyUser: boolean;
}

export function readStorageValue<T>(
  key: string,
  decode: (raw: string) => T,
  options: StorageReadOptions,
): StorageReadResult<T>;
```

执行顺序：

1. 若 GH35 failed-write shadow 存在，解码 shadow；否则调用 `localStorage.getItem`。
2. `null` 返回 `missing`，不 log、不 notify。
3. 有 raw value 时调用 decoder；decoder 必须返回完整有效值，否则 throw。
4. access error 返回 `failure`，`console.error` 只使用固定 access-failure 文案；不传原 access error，因为其 message 也可能携带 key/value。
5. decoder error 返回 `failure`，只输出固定 corruption 文案，不输出可能含 raw fragment 的原异常。
6. `notifyUser` 决定是否进入 read-failure channel；dedupe 传 `false`，其他 user-visible getters 传 `true`。

GH35 `writeStorageItem`、write shadow、write subscriber 保持不变。旧 `readStorageItem` 删除，仓库调用点与测试同 PR 迁移。

### 2. pending read-failure channel

storage adapter 新增：

- `STORAGE_READ_FAILURE_MESSAGE`：准确说明保存的数据未能加载并已使用默认值。
- `subscribeStorageReadFailures(listener): unsubscribe`。
- `pendingReadFailure: boolean` 与独立 listener set，不与 write-failure channel混用。

当 `notifyUser: true` 且没有 listener 时，只把 pending 设为 true，多次 startup failure 继续保持单一 pending。当首个 listener 注册时，先加入 set，再把 pending 清为 false并调用一次。已有 listener 时每次 failure 调用一次。listener 异常由 adapter 以固定 error 记录，不阻断其他 listener或 typed result。unsubscribe 删除 listener；测试消费 pending，避免跨测试泄漏。

App 导出并实际使用可运行时测试的 `subscribeStorageReadFailureToast(setToast, schedule?)` helper。helper 注册 `subscribeStorageReadFailures`；每次交付时先调用 `setToast(STORAGE_READ_FAILURE_MESSAGE)`，再由默认 `setTimeout` wrapper 或测试注入的 scheduler 清除 toast，并返回 unsubscribe。App 独立 effect 必须精确 `return subscribeStorageReadFailureToast(setToast);`。因为 state initializer 早于 effect，pending 机制保证 startup failure 不丢失；测试直接执行 App 使用的 helper，而不是用 SSR render 或符号搜索替代 effect 行为证据。

### 3. 严格 service decoders

各 getter 不再包 storage read catch，而是 switch typed result：

- `missing`：返回当前 default/empty。
- `failure`：返回相同 default/empty；error/toast 已由 adapter 处理。
- `value`：直接返回完整 decoder 结果。

Decoder 规则：

- tab/theme/style：只接受现有枚举。
- dock/settings-expanded/tray-cycle/tray-enabled：只接受字符串 `true`/`false`。
- budget：根必须是非数组 object；known source 缺失允许，存在则必须为有限正数。
- notification/panel/switcher：根必须是非数组 object；known field 缺失沿用 default，存在则必须是 boolean；未知字段忽略。switcher 解码后的 known fields 若全部为 `false`，必须判定 schema failure，不能绕过现有至少一个 provider 可见的不变量。
- event history：根必须是 array，全部元素都必须是合法 `AppEvent`；任一非法则整项失败并返回 `[]`。
- dedupe：根必须是非数组 object，全部 entries 必须是有限 number；任一非法或 JSON error 都是 failure。

`shouldNotify` 在 dedupe result 为 `failure` 时立即返回 false；不得构造 next、不得调用 write adapter。`missing` 仍表示空 dedupe record，成功路径不变。

### 4. 测试与覆盖率

新增 `tests/storage_read_failures.test.ts`：

- adapter：shadow/value/missing/access/decode 三态、safe log、active subscriber、unsubscribe、listener error；access exception message 与 raw value 分别包含 sentinel key/value，断言 console 只收到固定文案且 sentinel 不可见。
- startup/App：在无 subscriber 时触发多个 user-visible failure，再调用 App 实际使用的 `subscribeStorageReadFailureToast`；断言 `setToast` 恰好一次收到 `STORAGE_READ_FAILURE_MESSAGE`、注入 scheduler 清除 toast、unsubscribe 后后续 failure 不调用，并在测试结束前消费新 pending 防止泄漏。
- 13 个 public read entrypoints 的表驱动矩阵：有效、missing、access failure、malformed/schema failure，并断言各自 current default/value。
- 12 个 user-visible entrypoints 的 failure 进入 channel；dedupe failure listener 为零。
- switcher all-false schema：返回现有 all-visible default、固定 error、listener 一次。
- dedupe access/decode failure：`false`、setItem 零次；恢复后 `true` 且写一次。
- event mixed-invalid array 整项返回 `[]` 并通知一次。

更新 `tests/storage_write_failures.test.ts` 适配 typed reader，并完整重跑 GH35 测试，禁止削弱断言。

复用 GH35 已合并的 diff coverage checker：新增 TS/TSX 可执行行总体至少 80%；`storage.ts`、`notifications.ts`、`event_log.ts` 新增行各 100%。checker 自身既有 100% 测试继续通过。

## Affected Files / Allowlist

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
- `tests/storage_read_failures.test.ts`
- `tests/storage_write_failures.test.ts`
- `specs/GH38/tasks.md`

## Risks and Mitigations

| 风险 | 缓解措施 |
| --- | --- |
| missing 被误报为 failure | typed `missing` 独立分支；13-entrypoint missing matrix 断言零 log/零 listener。 |
| startup failure 发生在 effect 前而丢 toast | pending boolean + App 实际 helper 的运行时 subscribe-time delivery、message、scheduler clear、cleanup 测试。 |
| decoder 过宽继续吞坏数据 | known fields strict validation；每类 schema malformed case。 |
| access/decoder error 泄漏 key 或 raw value | 两类 log 均为固定文案，不传原 error/key/value；exception/raw sentinel 测试。 |
| dedupe 读失败后仍写/发送 | failure early return；setItem 零次与 recovery 专测。 |
| GH35 write shadow 被 typed read 破坏 | shadow-first adapter tests + 全量 storage_write_failures regression。 |
| 与其他优化冲突 | implementation 从 spec 合并后的最新 origin/main 创建；13-path allowlist。 |

## Product-to-Test Mapping

| Invariant | Implementation | Verification |
| --- | --- | --- |
| `B-001` missing 兼容 | typed result、所有 getters | 13-entrypoint missing matrix：current defaults、零 error/notification |
| `B-002` value/shadow 兼容 | storage adapter、decoders | success matrix + GH35 shadow/write regression |
| `B-003` user read failure 可见 | strict decoders、read channel | access/malformed matrix；safe error；listener once |
| `B-004` startup coalescing | pending + App helper/effect | App-used helper runtime：exact message once、scheduler clear、unsubscribe 后零调用 |
| `B-005` dedupe fail closed | notifications decoder/early return | access/decode failure false、setItem 0、recovery true |
| `B-006` event history failure | event strict decoder | access/mixed-invalid -> []、error + listener once |
| `B-007` 完整证据 | tests、coverage、CI | static gates、diff coverage、full frontend/Rust/PR gate |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git diff --quiet origin/main...HEAD -- . \
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
  ':(exclude)tests/storage_read_failures.test.ts' \
  ':(exclude)tests/storage_write_failures.test.ts' \
  ':(exclude)specs/GH38/tasks.md'
test -z "$(rg -l 'readStorageItem' src tests)"
test "$(rg -l 'localStorage\.getItem' src)" = "src/services/storage.ts"
rg -q 'return subscribeStorageReadFailureToast\(setToast\);' src/App.tsx
npm test
npm run build
node --experimental-test-coverage \
  --test-coverage-include=scripts/check_ts_diff_coverage.mjs \
  --test-coverage-lines=100 \
  --test-coverage-functions=100 \
  --test-coverage-branches=100 \
  --test scripts/check_ts_diff_coverage.test.mjs
npx vitest run --coverage \
  --coverage.include='src/**/*.{ts,tsx}' \
  --coverage.reporter=lcov \
  --coverage.reporter=text
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

回滚 implementation PR。没有 key、格式或数据迁移；回滚会恢复旧 raw reader、静默默认与 dedupe 读失败 fail-open 行为。

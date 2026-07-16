# GH-48 Tech Spec：delivery-first notification dedupe 状态机

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/48
- Product spec: `specs/GH48/product.md`

## Root Cause

`shouldNotify` 同时读取 eligibility 与写入 sent timestamp，`notify` 又在任何 `await import`/permission/send 之前调用它。因此 state order 是 `eligible → committed → attempted`。catch 只 console.error，调用方无法区分 sent、duplicate、denied 或 transport failure。

## Preflight Contract

implementation 必须从 spec merge 后 then-latest `origin/main` 创建，并在 edit 前验证：

- `notify` 仍在 permission/plugin/send 前调用 mutating `shouldNotify`。
- denial 与 send-throw disposable reproduction 均证明 next same-body `shouldNotify=false`。
- existing notification/storage suites 与 baseline build 全绿。

任一行为漂移必须先更新 GH48 spec。

## Proposed Design

### 1. Typed states

```ts
export type NotificationDeliveryResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: 'backend_unavailable' | 'duplicate' | 'in_flight' }
  | { status: 'failure'; message: string };

export interface NotificationDeliveryOptions {
  on_failure?: (message: string) => void;
}
```

固定 messages 区分 dedupe unavailable、permission denied、delivery failed；不得拼接 original error/body/key。failure helper 同时返回 result 并调用 `on_failure` exactly once；callback 自身抛错必须被 fixed safe console error 捕获，不能改变 delivery result。

### 2. State transitions

`shouldNotify(body, now)` 只读取 typed storage result：failure→false，missing/expired→true，recent→false，零 write。

`notify(title, body, options)`：

1. no backend → skipped/backend_unavailable。
2. body already in module-local `in_flight` → skipped/in_flight。
3. read eligibility：storage failure → typed failure；recent → skipped/duplicate。
4. add body to `in_flight`，进入 `try/finally`。
5. dynamic import；permission check/request。denied → typed failure。
6. 调用 `sendNotification`；无异常返回才算 delivered。
7. 写 timestamp + pruning。write 使用 `preserveSessionValue: true, notifyUser: false`；false 表示 persistent write failed but session shadow exists，仍返回 sent。
8. finally 无条件删除 `in_flight`。

timestamp 使用 delivery commit 时的 `Date.now()`，不是 eligibility start time。不同 body 独立。send 为同步 API，但 dynamic import/permission awaits 使 concurrent call 必须有 guard。

### 3. Callers

`use_service_events.ts` 与 App bonus caller 均传：

```ts
{ on_failure: (message) => logEvent('critical', message) }
```

callback 只写 event，不调用 notify，不产生 recursion。现有 threshold/bonus event 仍先记录原 warning/critical，再在 delivery failure 时追加 fixed critical event。

### 4. Tests and coverage

新 `tests/notification_delivery_failures.test.ts` mock Tauri plugin/backend marker、fake timers 与 memory/throwing storage，逐项验证 B-001~B-006。现有 `notifications.test.ts` 改为 read-only eligibility assertions；storage read/write suites 更新 dedupe contract，并保留 corrupt/access/write failure regression。

diff coverage checker：overall ≥80%，`src/services/notifications.ts=100`。App/hook caller lines通过 source-level exact checks与 integration outcome callback tests；禁止 dummy code。

## Affected Files / Allowlist

- `src/services/notifications.ts`
- `src/hooks/use_service_events.ts`
- `src/App.tsx`
- `tests/notifications.test.ts`
- `tests/notification_delivery_failures.test.ts`
- `tests/storage_read_failures.test.ts`
- `tests/storage_write_failures.test.ts`
- `specs/GH48/tasks.md`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| mark-after-send permits concurrent duplicates | module-local same-body in-flight guard + concurrent test。 |
| guard leaks after denial/error | single try/finally + every terminal-path retry test。 |
| successful send then storage failure repeats | preserveSessionValue shadow + same-session duplicate test。 |
| permission denial silently disappears | typed failure + on_failure exact-once event。 |
| original errors leak | fixed constants + safe callback-error log assertions。 |
| refactor changes window/pruning | deterministic fake-time boundary/different-body tests。 |
| public contract ambiguity | discriminated union; no void/boolean conflation。 |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` read-only eligibility | missing/recent/expired/corrupt/access tests + zero setItem |
| `B-002` failure retry | denial/permission throw/send throw/plugin failure + retry |
| `B-003` success commit | sent then duplicate; different body; timestamp at commit |
| `B-004` concurrency | deferred permission + Promise.all same/different bodies |
| `B-005` post-send write failure | sent + session shadow + one send |
| `B-006` visibility/regression | typed outcomes、on_failure、safe messages、coverage/full gates |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)src/services/notifications.ts' \
  ':(exclude)src/hooks/use_service_events.ts' \
  ':(exclude)src/App.tsx' \
  ':(exclude)tests/notifications.test.ts' \
  ':(exclude)tests/notification_delivery_failures.test.ts' \
  ':(exclude)tests/storage_read_failures.test.ts' \
  ':(exclude)tests/storage_write_failures.test.ts' \
  ':(exclude)specs/GH48/tasks.md'
rg -n "on_failure.*logEvent\('critical'" src/App.tsx src/hooks/use_service_events.ts
npx vitest run tests/notification_delivery_failures.test.ts tests/notifications.test.ts tests/storage_read_failures.test.ts tests/storage_write_failures.test.ts
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
  --critical src/services/notifications.ts=100
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Rollback Plan

回滚 implementation PR，恢复旧 pre-send dedupe。无 schema、window、settings、dependency 或 data migration；已有 dedupe JSON 保持兼容。

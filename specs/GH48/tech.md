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

module-local `delivered_this_session: Map<string, number>` 保存成功 delivery timestamp，并在每次 eligibility/commit 按 12 小时窗口 pruning。eligibility 先检查该 map，再读 persistent/shadow storage。

`notify(title, body, options)`：

1. no backend → skipped/backend_unavailable。
2. body already in module-local `in_flight` → skipped/in_flight。
3. read eligibility：storage failure → typed failure；recent → skipped/duplicate。
4. add body to `in_flight`，进入 `try/finally`。
5. dynamic import；permission check/request。denied → typed failure。
6. 调用 `sendNotification`；无异常返回才算 delivered。
7. send 成功后立即把 body/commit-time `Date.now()` 写入 session map。
8. 重新 fresh typed read 当前 persistent/shadow dedupe；不能复用 pre-send eligibility snapshot。read success/missing 时 merge 所有仍在窗口内的 entries + 当前 body 后写入；这段 fresh-read/merge/write 无 `await`，避免不同 body concurrent lost update。
9. fresh read failure 时不做 persistent overwrite；session map 已保证本 session dedupe，返回 sent。write 使用 `preserveSessionValue: true, notifyUser: false`；false 时 shadow 保存 merged state，仍返回 sent。
10. finally 无条件删除 `in_flight`。

timestamp 使用 delivery commit 时的 `Date.now()`，不是 eligibility start time。不同 body 并发测试必须在两次成功后断言 storage 同时包含 A/B，随后 A/B 都 duplicate；post-send fresh-read failure 必须断言 sent + session duplicate。send 为同步 API，但 dynamic import/permission awaits 使 concurrent call 必须有 guard。

### 3. Callers

`notifications.ts` 提供 pure `createNotificationFailureOptions(log_event)`；它只返回：

```ts
{ on_failure: (message) => log_event('critical', message) }
```

App bonus 与 hook 内 80%/95% 三个 `notify` callsites 的第三参数都必须精确为 `createNotificationFailureOptions(logEvent)`。callback 只写 event，不调用 notify，不产生 recursion。unit test 验证 callback behavior；Test Plan 的 TypeScript AST gate 验证 callsite count/third argument，并检查 helper callback 只有一个 `log_event('critical', message)` CallExpression、零 `notify` identifier。

### 4. Tests and coverage

新 `tests/notification_delivery_failures.test.ts` mock Tauri plugin/backend marker、fake timers 与 memory/throwing storage，逐项验证 B-001~B-006，包括 different-body Promise.all 后 persistent A/B 与 subsequent duplicate、post-send fresh-read failure 的 session dedupe。现有 `notifications.test.ts` 改为 read-only eligibility assertions；storage read/write suites 更新 dedupe contract，并保留 corrupt/access/write failure regression。

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
| different body concurrent commits overwrite | post-send fresh read/merge/prune without await + A/B storage/subsequent duplicate test。 |
| successful send then fresh-read/write failure repeats | delivered session timestamp map + shadow where writable + same-session duplicate tests。 |
| permission denial silently disappears | typed failure + on_failure exact-once event。 |
| original errors leak | fixed constants + safe callback-error log assertions。 |
| refactor changes window/pruning | deterministic fake-time boundary/different-body tests。 |
| public contract ambiguity | discriminated union; no void/boolean conflation。 |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` read-only eligibility | missing/recent/expired/corrupt/access tests + zero setItem |
| `B-002` failure retry | denial/permission throw/send throw/plugin failure + retry |
| `B-003` success commit | sent then duplicate; concurrent A/B both persisted; timestamp at commit |
| `B-004` concurrency | deferred permission + Promise.all same/different bodies |
| `B-005` post-send persistence failure | fresh-read failure/write failure both sent + session duplicate |
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
node --input-type=module -e "
  import ts from 'typescript';
  import { readFileSync } from 'node:fs';
  const parse = (path) => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const notifyCalls = [];
  for (const path of ['src/App.tsx', 'src/hooks/use_service_events.ts']) {
    const source = parse(path);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'notify') notifyCalls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (notifyCalls.length !== 3) process.exit(1);
  for (const call of notifyCalls) {
    const option = call.arguments[2];
    if (!option || !ts.isCallExpression(option) || !ts.isIdentifier(option.expression) || option.expression.text !== 'createNotificationFailureOptions') process.exit(1);
    if (option.arguments.length !== 1 || !ts.isIdentifier(option.arguments[0]) || option.arguments[0].text !== 'logEvent') process.exit(1);
  }
  const notifications = parse('src/services/notifications.ts');
  let helper;
  const find = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'createNotificationFailureOptions') helper = node;
    ts.forEachChild(node, find);
  };
  find(notifications);
  if (!helper) process.exit(1);
  const statements = helper.body?.statements ?? [];
  if (statements.length !== 1 || !ts.isReturnStatement(statements[0])) process.exit(1);
  const result = statements[0].expression;
  if (!result || !ts.isObjectLiteralExpression(result) || result.properties.length !== 1) process.exit(1);
  const property = result.properties[0];
  if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || property.name.text !== 'on_failure') process.exit(1);
  const callback = property.initializer;
  if (!ts.isArrowFunction(callback) || callback.parameters.length !== 1 || callback.parameters[0].name.getText(notifications) !== 'message') process.exit(1);
  const invocation = callback.body;
  if (!ts.isCallExpression(invocation) || !ts.isIdentifier(invocation.expression) || invocation.expression.text !== 'log_event') process.exit(1);
  if (invocation.arguments.length !== 2 || !ts.isStringLiteral(invocation.arguments[0]) || invocation.arguments[0].text !== 'critical') process.exit(1);
  if (!ts.isIdentifier(invocation.arguments[1]) || invocation.arguments[1].text !== 'message') process.exit(1);
  let recursive = false;
  const rejectNotify = (node) => {
    if (ts.isIdentifier(node) && node.text === 'notify') recursive = true;
    ts.forEachChild(node, rejectNotify);
  };
  rejectNotify(helper);
  if (recursive) process.exit(1);
"
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

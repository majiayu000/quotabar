# GH-58 Tech Spec：fail-safe fatal frontend reporter

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/58
- Product spec: `specs/GH58/product.md`

## Root Cause

入口 module 的 `reportFatalError(source, error)` 在任何保护逻辑前读取/转换 raw error，随后把 raw identity 交给 `console.error`，把 message/stack 写入 DOM。三类 callbacks 还主动读取 `event.error`、`event.message` 与 `event.reason`。DOM mutation 使用每次新建/append node 的无所有权模型，且 empty catch 吞掉 reporter failure。因此 confidentiality、reporter liveness、single-surface ownership 与 failure observability 同时缺失。

## Preflight Contract

implementation 必须从 spec merge 后 then-latest `origin/main` 创建，并在 edit 前验证：

- disposable entry-module reproduction 仍证明 private marker 进入 console/DOM，append failure 无 fixed secondary diagnostic。
- `src/main.tsx` 仍读取/转换 raw payload、每次 append 新 `<pre>` 且存在 empty catch。
- search-first 无同类 issue/PR，baseline frontend/build/Rust 全绿。

任一行为漂移必须先更新 GH58 spec。

## Proposed Design

### 1. Closed source and fixed messages

module-local contract：

```ts
type FatalErrorSource = 'window' | 'promise' | 'react';

const FATAL_ERROR_MESSAGE =
  'Quotabar encountered an unexpected interface error. Restart the app.';
const FATAL_SURFACE_ERROR_MESSAGE = 'Failed to display fatal frontend error.';
const FATAL_SURFACE_ID = 'quotabar-fatal-error';
```

`report_fatal_error(source: FatalErrorSource): void` 不接收 raw value。三个 callbacks 都忽略全部 callback arguments，只传 literal source；禁止读取 `event.error`、`event.message`、`event.reason`，禁止 Error narrowing、`String`、JSON serialization 或 raw console argument。

每次调用先执行一次下列 primary diagnostic；只有一个 string argument：

```ts
console.error(`[fatal:${source}] ${FATAL_ERROR_MESSAGE}`);
```

### 2. Single owned surface

在一个 `try/catch` 内：

- 用 `document.getElementById(FATAL_SURFACE_ID)` 查找已有 surface。
- 没有时创建 `pre`，设置 fixed ID 与既有 fixed safe CSS，使用 `textContent` 写 fixed `[source] message`，再 append 到 `document.body`。
- 已存在时只更新 `textContent` 为最新 fixed source/message；不得创建或 append 新 node。
- 不使用 module cache 作为 DOM ownership truth，避免 node 被外部移除后持有 stale reference；每次以 fixed ID lookup 为准。

surface 允许 `HTMLElement`，但创建路径必须为 `<pre>`。禁止 `innerHTML`、insertAdjacentHTML 或 raw interpolation。

### 3. Observable reporter failure

lookup/create/id/style/text/append 任一同步 throw 进入唯一 catch。catch 不绑定 caught value，固定执行一次：

```ts
console.error(FATAL_SURFACE_ERROR_MESSAGE);
```

不得传递 DOM exception。primary log 已在 try 外完成，因此每次 DOM failure 恰有 primary safe log once + secondary safe log once。console API 自身 failure 与浏览器全局事件递归策略不在本 issue scope。

### 4. Entry wiring

- `window.addEventListener('error', () => report_fatal_error('window'))`
- `window.addEventListener('unhandledrejection', () => report_fatal_error('promise'))`
- React root option `onUncaughtError: () => report_fatal_error('react')`

root element lookup、StrictMode、App 与 render count 不变。函数与常量保持 module-local，不新增 public API。

### 5. Deterministic entry-module tests

新增 `tests/fatal_error_reporting.test.tsx`。mock React root/App boundary，真实 import `src/main.tsx`，捕获真实 listeners、root options、render call；fake document/surface 提供可控 getter/setter/operation failures。

| Case group | Required cases |
| --- | --- |
| Wiring | 两个 window listeners exactly once；root element/options/render exactly once |
| Channels | window Error、promise object、React Error；fixed source-specific log/text |
| Raw safety | raw identity/message/stack/nested marker absent；throwing getters/toString never evaluated |
| Ownership | first create/append once；three channels reuse one ID surface；existing surface path zero create/append |
| DOM terminals | lookup、create、id、style、text、append 各自 throw；primary/secondary exact counts、zero throw/raw |
| Injection | HTML-like marker absent；innerHTML setter never called；actual callbacks never access raw getters |

使用 `vi.resetModules()`、deferred-free synchronous callbacks 与 explicit stubs；不依赖 jsdom、wall-clock sleep 或 copied reporter helper。

## Affected Files / Allowlist

- `src/main.tsx`
- `tests/fatal_error_reporting.test.tsx`
- `specs/GH58/tasks.md`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Sanitization removes debugging detail | fixed source keeps channel attribution；安全优先，不显示 raw。 |
| duplicate fatal events create overlays | fixed-ID DOM lookup ownership + multi-channel reuse test。 |
| reporter crashes on hostile payload | callbacks discard arguments；throwing getter/toString test。 |
| DOM stub passes while real wiring drifts | import real entry module and capture actual registered callbacks/root options。 |
| innerHTML introduces injection | textContent exact assertion + innerHTML runtime trap。 |
| DOM failure becomes silent | fixed secondary diagnostic exact-count matrix。 |
| scope expands into global error UI | exact 3-path allowlist。 |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` | entry wiring/root render exact-count tests |
| `B-002` | three channel safe primary logs + raw negative assertions |
| `B-003` | exact fixed surface text per source |
| `B-004` | first/existing/repeated single-surface matrix |
| `B-005` | six DOM operation failure terminals |
| `B-006` | throwing getter/toString payload cases |
| `B-007` | innerHTML trap + DOM failure observability + no empty catch |
| `B-008` | allowlist、coverage、full local/CI/current-head review |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)src/main.tsx' \
  ':(exclude)tests/fatal_error_reporting.test.tsx' \
  ':(exclude)specs/GH58/tasks.md'
npx vitest run tests/fatal_error_reporting.test.tsx
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
  --critical src/main.tsx=100
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check origin/main...HEAD
```

## Rollback Plan

回滚 implementation PR。无 backend、schema、payload、persistence、interval、cache、dependency 或 migration；旧行为将恢复为 raw fatal data 写 console/DOM、duplicate surfaces 与 silent reporter failure。

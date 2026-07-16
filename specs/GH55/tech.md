# GH-55 Tech Spec：lifecycle-safe popover visibility state machine

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/55
- Product spec: `specs/GH55/product.md`

## Root Cause

visibility effect 同时启动 `isVisible()` 与 `onFocusChanged()`，但两个 rejection handler 均无条件 `setWindowVisible(true)` 且不记录错误。initial read、focus callback 与 subscription failure 没有 precedence 标记，因此较晚 read 可覆盖较新的 authoritative event/failure。focus callback 不检查 `mounted`；listener promise 在 cleanup 前后 resolve/reject 的 ownership 也没有完整 terminal contract。

## Preflight Contract

implementation 必须从 spec merge 后 then-latest `origin/main` 创建，并在 edit 前验证：

- disposable real-React reproduction 仍显示 read rejection 后 `[false, true]` 且无 safe visibility log。
- hook 仍有两个 silent `setWindowVisible(true)` rejection fallbacks，focus callback 仍无 mounted guard。
- search-first 无同类 issue/PR，baseline frontend/build/Rust 全绿。

任一行为漂移必须先更新 GH55 spec。

## Proposed Design

### 1. Explicit effect-owned lifecycle state

保持 `usePopoverWindow(containerRef, resizeDeps): boolean` public contract 不变。Tauri visibility effect 内使用四个 effect-owned bindings：

- `mounted: boolean`：cleanup 后立即 false；所有 async/callback terminal 第一条件。
- `read_superseded: boolean`：mounted focus callback 或 subscription failure 后 true；initial read terminal 只在 false 时提交。
- `unlisten: (() => void) | null`：resolved listener ownership；normal cleanup 或 late resolution 二选一调用 exactly once。

不得使用 public `any`、alias、silent catch 或 raw error logging。

### 2. Safe failure contract

固定 module-local messages：

```ts
const VISIBILITY_READ_ERROR_MESSAGE = 'Failed to read popover window visibility';
const FOCUS_SUBSCRIPTION_ERROR_MESSAGE = 'Failed to subscribe to popover focus changes';
```

read sync throw/rejection 共用一个 handler：若已 unmounted 则作为 stale terminal 零副作用；否则只传固定 string 给 `console.error`，并在 `read_superseded === false` 时 `setWindowVisible(false)`。不得传递 caught value。

subscription sync throw/rejection 共用另一个 handler：若 mounted，先设置 `read_superseded=true`，再固定安全 log 一次并 `setWindowVisible(false)`；若已 unmounted，零副作用。每次 throw/rejection 只能由一个 handler 处理，禁止 double log。

### 3. Ordering and ownership

- browser/non-Tauri branch 保持 `setWindowVisible(true); return`，不创建 current window。
- Tauri branch 同一 effect 内启动 read 与 focus registration；两次 API invocation 均用 sync `try/catch` 包住，returned promise 使用 success/rejection handlers。
- read success：仅 `mounted && !read_superseded` 时提交 returned boolean。
- focus callback：仅 mounted 时设置 `read_superseded=true` 并提交 payload boolean；unmounted callback 直接 return。
- subscription success：mounted 时保存 returned unlisten；已 cleanup 时立即调用 returned unlisten once。
- cleanup：先 `mounted=false`，再取出并清空 stored unlisten，若存在调用 once。清空 ownership 防止 duplicate stop。

### 4. Deterministic real-React tests

新增 `tests/popover_window_visibility.test.tsx`，直接 render 使用真实 `usePopoverWindow` 的 probe component；mock 仅覆盖 Tauri boundary、ResizeObserver/backend resize 与 timers。使用 deferred promises 和 captured focus callback，不测试复制 helper。

| Case group | Required cases |
| --- | --- |
| Environment | browser/non-Tauri visible=true、零 Tauri calls |
| Initial read | visible=true、visible=false、rejection、sync throw |
| Focus | mounted callback true→false、false→true |
| Subscription failure | rejection、sync throw，均 fail closed |
| Ordering | focus=true/false 后 late read true、false、rejection；subscription reject/throw 后 late read true、false、rejection；authoritative terminal 不被 read 覆盖 |
| Cleanup/read | unmount 后 late read resolve、reject；零 render/log |
| Cleanup/subscription | unmount 后 late resolve 调 stop once；late reject 零 log；normal cleanup stop once |
| Cleanup/callback | captured callback after unmount 零 render/log |
| Safe logs | fixed message exact once；raw Error identity/message/stack absent；双 failure 各一次 |

React act environment、renderer compatibility 与 cleanup 必须 deterministic；测试不得依赖 wall-clock sleep。

## Affected Files / Allowlist

- `src/hooks/use_popover_window.ts`
- `tests/popover_window_visibility.test.tsx`
- `specs/GH55/tasks.md`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| late initial read overwrites focus event | `read_superseded` precedence + deferred race cases。 |
| listener resolves after cleanup and leaks | late success immediately invokes returned stop exactly once。 |
| callback fires after cleanup | mounted-first callback guard + captured-callback test。 |
| error logging leaks Tauri payload | fixed string only + raw identity/text/stack negative assertions。 |
| subscription loss leaves stale visible=true or late read reopens it | failure sets `read_superseded` before fail-closed false；late-read matrix。 |
| browser behavior regresses | explicit no-Tauri test asserts visible=true and zero Tauri calls。 |
| scope expands into resize/provider code | 3-path allowlist + unchanged public signature。 |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` | browser/non-Tauri case with zero window API calls |
| `B-002` | initial true/false + read reject/throw |
| `B-003` | focus toggles + six late-read ordering cases |
| `B-004` | subscription reject/throw from visible/hidden baselines + late-read ordering |
| `B-005` | cleanup before each read/subscription terminal + callback |
| `B-006` | normal and late listener resolution stop counts |
| `B-007` | exact fixed logs + raw payload negative assertions |
| `B-008` | allowlist、coverage、full local/CI/current-head review |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)src/hooks/use_popover_window.ts' \
  ':(exclude)tests/popover_window_visibility.test.tsx' \
  ':(exclude)specs/GH55/tasks.md'
node -e "
  const manifest = require('./package.json');
  if (manifest.dependencies?.['react-test-renderer'] || manifest.dependencies?.['@types/react-test-renderer']) process.exit(1);
  if (!manifest.devDependencies?.['react-test-renderer'] || !manifest.devDependencies?.['@types/react-test-renderer']) process.exit(1);
  const lock = require('./package-lock.json');
  const react = lock.packages?.['node_modules/react']?.version;
  const renderer = lock.packages?.['node_modules/react-test-renderer']?.version;
  if (!react || renderer !== react) process.exit(1);
"
npx vitest run tests/popover_window_visibility.test.tsx
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
  --critical src/hooks/use_popover_window.ts=100
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

## Rollback Plan

回滚 implementation PR。无 backend、schema、payload、persistence、interval、cache、UI 或 dependency migration；旧行为将恢复为 visibility failure 时静默 visible=true。

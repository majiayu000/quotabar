# GH-61 Tech Spec：pure switcher visibility transaction

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/61
- Product spec: `specs/GH61/product.md`

## Root Cause

当前 handler 把 decision、state transition 与 persistence 混在 React functional updater 中：

```ts
let blocked = false;
setSwitcherVisibility((prev) => {
  // assigns blocked and persists here
});
if (blocked) {
  // may run before updater assignment
}
```

`blocked` 的可见性依赖 React updater scheduling，而 updater 内 persistence 又违反 updater purity。结果是 deferred evaluation 丢失 blocked feedback，StrictMode repeated evaluation 重复写入。根因不是 toast renderer、storage API 或 SettingsView control，而是 event transaction boundary 错置。

## Preflight Contract

implementation 必须从 spec merge 后 then-latest `origin/main` 创建，并在 edit 前验证：

- disposable real-App StrictMode reproduction 仍证明 blocked toast 缺失与 accepted persistence count 2。
- `handleSwitcherToggle` 仍在 functional updater 内设置 blocked/persist，并在 updater 外同步读取 blocked。
- search-first 无同类 issue/PR，baseline frontend/build/Rust 全绿。

任一行为漂移必须先更新 GH61 spec。

## Proposed Design

### 1. Render-snapshot decision

`handleSwitcherToggle` 直接读取 callback closure 对应的 current committed `switcherVisibility`：

```ts
const nextValue = !switcherVisibility[service];
const wouldHideLast = !nextValue
  && !SERVICES.some((other) => other !== service && switcherVisibility[other]);
```

真实 SettingsView user event 使用最新 committed callback；不为同一 callback 的 reentrant programmatic calls 引入额外 ref/reducer API。

### 2. Blocked terminal

`wouldHideLast` 时立即：

- `setToast('At least one provider must stay in the switcher')` exactly once；
- `setTimeout(() => setToast(null), TRAY_GUARD_TOAST_MS)` exactly once；
- return，不调用 state setter 或 persistence。

state 因未提交 transition 而保持完整 snapshot。不得把 toast/timer 放回 state updater 或 render path。

### 3. Accepted terminal

accepted 时构造一次 exact next snapshot：

```ts
const next = { ...switcherVisibility, [service]: nextValue };
setSwitcherVisibility(next);
saveSwitcherVisibility(next);
```

两项 event side effects 各执行一次。不得传 functional updater，避免 StrictMode purity probe 重放 persistence。继续忽略 saver boolean，因为既有 storage failure listener 负责用户提示；本 issue 不改变 failure routing。

handler dependency 必须包含 `switcherVisibility`，确保每次 committed render 生成对应 snapshot 的 callback。

### 4. Existing fallback

保留现有 effect：当 active provider 变 hidden 时调用 `setAndPersistTab('all')`。不改变 SettingsView props、storage schema 或 provider refresh flow。

### 5. Deterministic real-App tests

新增 `tests/switcher_visibility_transactions.test.tsx`：

- mock popover/backend 与初始 saved visibility，但 import/mount 真实 App、SettingsView 和 StrictMode；
- 从 rendered `SettingsView` props 调用真实 callback，每次 accepted transition 后重新获取 latest instance/callback；
- 参数化四个 only-visible blocked states；
- 参数化 hidden→visible 与 visible-with-peer→hidden accepted states；
- spy `saveSwitcherVisibility` exact calls/arguments；
- fake timer + timeout spy 验证 fixed delay 和 toast lifecycle；
- 至少一例 active hidden 后 Overview fallback。

不复制 production decision helper，不依赖 wall-clock、DOM environment 或 AST-only evidence。

## Affected Files / Allowlist

- `src/App.tsx`
- `tests/switcher_visibility_transactions.test.tsx`
- `specs/GH61/tasks.md`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| callback closure becomes stale | dependency includes full visibility snapshot；每次 accepted event 后测试重新获取 committed callback。 |
| guard only works for Claude | four-service parameterized only-visible matrix。 |
| StrictMode still duplicates storage | actual StrictMode mount + exact save count。 |
| accepted transition mutates peers | exact full-object argument/state assertions。 |
| toast timer becomes flaky | fake timers + fixed delay spy，无 sleep。 |
| storage failure routing changes | saver return contract untouched；existing global subscriber remains owner。 |
| App scope expands | exact 3-path allowlist；不改 tray/storage/backend。 |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` | real App/SettingsView callback capture + four service matrix |
| `B-002` | only-visible blocked state/save/toast assertions |
| `B-003` | timeout delay/count + pre/post-expiry toast assertions |
| `B-004` | StrictMode accepted enable/disable state and exact saver argument/count |
| `B-005` | current implementation fails save count 2；fixed behavior exact once/zero |
| `B-006` | active-hidden Overview fallback + unchanged boundary checks |
| `B-007` | allowlist、coverage、full local/CI/current-head review |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)src/App.tsx' \
  ':(exclude)tests/switcher_visibility_transactions.test.tsx' \
  ':(exclude)specs/GH61/tasks.md'
npx vitest run tests/switcher_visibility_transactions.test.tsx
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
  --critical src/App.tsx=100
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check origin/main...HEAD
```

## Rollback Plan

回滚 implementation PR。无 backend、schema、payload、persistence format、dependency 或 migration；旧 behavior 将恢复为 blocked feedback scheduling-dependent 与 StrictMode duplicate persistence。

# GH-52 Tech Spec：request generation latest-wins guard

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/52
- Product spec: `specs/GH52/product.md`

## Root Cause

各 fetch function 在调用时直接 await backend，完成后无条件 setState/callback/finally。React effect 的 interval cleanup 只能停止未来 tick，不能识别已经在途的旧请求；manual nonce 也不会取消 startup/interval 请求。Cost effect 的 `cancelled` 只覆盖 dependency cleanup，不能区分同一 effect 内重叠 interval calls。

## Preflight Contract

implementation 必须从 spec merge 后 then-latest `origin/main` 创建，并在 edit 前验证：

- Codex real-component deferred reproduction 仍为 `20 → stale 90`。
- Claude、Cursor、Antigravity 与 Cost source 仍无 generation/current check。
- search-first 无同类 issue/PR，baseline frontend/build 全绿。

任一行为漂移必须先更新 GH52 spec。

## Proposed Design

### 1. Stable request generation hook

新增 `src/hooks/use_latest_request_generation.ts`：

```ts
export interface LatestRequestGeneration {
  begin(): number;
  isCurrent(generation: number): boolean;
  invalidate(): void;
}

export function createLatestRequestGeneration(): LatestRequestGeneration;
export function useLatestRequestGeneration(): LatestRequestGeneration;
```

内部 `current_generation` 从 0 开始；`begin()` 递增并返回 token，`isCurrent()` exact compare，`invalidate()` 递增。hook 返回稳定 object，并在 unmount cleanup 调用 `invalidate()`。无 public `any`、无 alias、无 silent catch。

### 2. Provider transition template

Claude/Codex/Cursor/Antigravity 的每次 fetch 必须遵循：

1. `const generation = request_generation.begin()`。
2. 设置本次 start/loading 状态。
3. await 当前完整 backend request/bundle。
4. success 第一条语句检查 `isCurrent(generation)`；false 立即 return，之后才允许 setState/parent callbacks。
5. catch 第一条语句同样 fail closed；stale error 零副作用，current error 保持现有 message/state/callback semantics。
6. finally 仅在 current 时结束 loading。

Codex 的 `Promise.all(info, limits, credits)` 保持 atomic；不得逐 member commit。manual/startup/interval 继续调用同一个 `fetchData`，因此自动共享 guard。Antigravity interval 增加与 Codex/Cursor 相同的 `<=0` pause branch。

App Claude 的 request generation hook 放在现有 `fetchClaudeQuota` ownership scope；manual 和 self-scheduled background call 共用。旧 429/error 不能改变 current interval selection、quota、connected 或 loading。

实现变量名固定为：App `claude_request_generation`；Codex/Cursor/Antigravity `request_generation`；Cost `overview_generation` 与 `daily_generation`。

### 3. Cost lanes

`CostSummarySection` 使用两个 stable generation objects：

- `overview_generation`：overview/loading/error。
- `daily_generation`：daily series/fallback。

两 lane 独立 begin/current/invalidate。effect cleanup invalidate 两者；新 effect 仍启动两 lane。overview stale finally 不清新 overview loading；daily stale error 不把新 daily 设 null。现有 merge functions 与 error message contract不变。

### 4. Fail-closed wiring checker

新增 `scripts/check_latest_request_wiring.mjs`，使用 TypeScript AST 对真实 owner function 的 binding、token dataflow 与 control flow 做 exact validation，而不是只计数 method syntax：

- generation variable declarator initializer 必须是 `useLatestRequestGeneration()`，变量名与 owner 固定映射一致。
- 真实 target function 固定为 App `fetchClaudeQuota`、三个 panel 的 `fetchData`、Cost 的 `loadCost` 与 `loadDaily`；async body 的第一条 executable statement 必须是对应 owner 的 `const generation = <owner>.begin()`。真实 await callee 映射固定为 `backend.getQuota`、Codex `Promise.all(backend.getCodexInfo/getCodexRateLimits/getCodexResetCredits)`、`backend.getCursorInfo`、`backend.getAntigravityInfo`、Cost `Promise.all(...backend.getCostOverview)` 与 `Promise.all(...backend.getCostDaily)`。
- backend await 后的 success、catch 第一条 executable statement、finally loading write 都必须由对应 owner 的 `isCurrent(generation)` fail-closed guard 控制；guard false 必须 return，token/owner 不得替换。
- Cost owning effect cleanup 必须调用 `overview_generation.invalidate()` 与 `daily_generation.invalidate()`；Antigravity 必须存在 `autoRefreshIntervalMs <= 0` 的 no-timer branch。
- checker 对缺失、额外、错误 owner/token、guard 在 fetch 外、dummy hook/fake object、dead-code guard、缺 catch/finally、缺 Cost invalidate、缺 interval-zero branch 全部失败。

新增 `scripts/check_latest_request_wiring.test.mjs`，用 valid fixture 与上述逐类 adversarial fixtures 验证 fail-closed；checker 自身 Node line/function/branch coverage 全部 100%。

### 5. Tests

- `tests/latest_request_generation.test.ts`：begin monotonic、current replacement、invalidate、hook unmount cleanup，critical 100%。
- `tests/provider_refresh_races.test.tsx`：dev-only real React effects，使用 parameterized deferred promises，按下表逐 owner/terminal 完整执行；禁止只测 helper。
- 每个 provider 同时断言 visible state 或 callback、error、loading 中适用的维度；current failure 不得因 stale suppression 被吞。
- renderer 仅为 dev dependency，版本必须与 `package-lock.json` resolved React 版本兼容；不得进入 `dependencies`。

| Owner/lane | Required deterministic cases |
| --- | --- |
| Claude | new-success/old-success、new-success/old-failure、new-failure/old-success、stale-finally-while-current-pending、unmount |
| Codex | 同上；另对 info/limits/credits 每个 member parameterize current rejection 与 stale rejection |
| Cursor | new-success/old-success、new-success/old-failure、new-failure/old-success、stale-finally-while-current-pending、unmount |
| Antigravity | 同上；另断言 interval `0` 不注册 timer |
| Cost overview | new-success/old-success、new-success/old-failure、new-failure/old-success、stale-finally-while-current-pending、effect cleanup |
| Cost daily | new-success/old-success、new-success/old-failure、new-failure/old-success、effect cleanup |
| Cost cross-lane | overview 与 daily 同时在途时互不 invalidate，任一 lane 的新 request 不改变另一 lane current identity |

## Affected Files / Allowlist

- `src/hooks/use_latest_request_generation.ts`
- `src/App.tsx`
- `src/components/CodexPanel.tsx`
- `src/components/CursorPanel.tsx`
- `src/components/AntigravityPanel.tsx`
- `src/components/CostSummarySection.tsx`
- `tests/latest_request_generation.test.ts`
- `tests/provider_refresh_races.test.tsx`
- `scripts/check_latest_request_wiring.mjs`
- `scripts/check_latest_request_wiring.test.mjs`
- `package.json`
- `package-lock.json`
- `specs/GH52/tasks.md`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| stale finally clears new loading | current check inside finally + deferred assertion。 |
| helper tested but component not wired | real component effect tests for every owner + fail-closed wiring checker。 |
| dummy/dead AST syntax bypasses gate | checker binds exact hook declarator、real fetch、token dataflow、backend await、terminal control flow；adversarial fixtures 100% coverage。 |
| one provider uses separate manual guard | exact owner/function mapping requires one coordinator per provider fetch owner。 |
| cost overview invalidates daily | two independent coordinator identities + cross-lane test。 |
| unmount callbacks leak | hook cleanup invalidate + deferred unmount test。 |
| current failures silently disappear | only stale failure ignored；current failure regression assertions。 |
| React test dependency drifts runtime | dev-only placement + resolved-version compatibility gate。 |
| scope expands into tray writes | allowlist + explicit non-goal。 |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` latest success only | 每个 provider 与每条 Cost lane 的 parameterized old/new success |
| `B-002` stale failures ignored | 每个 owner/lane 的 old failure/new success 与 new failure/old success；Codex 三个 bundle members current/stale rejection |
| `B-003` loading ownership | 每个 provider 与 Cost overview 的 stale finally while current pending |
| `B-004` cleanup invalidation | 每个 provider unmount 与两条 Cost lane cleanup deferred completion |
| `B-005` lane ownership | Codex atomic bundle + Cost cross-lane identity test |
| `B-006` shared entry points/pause | manual+startup races、fake interval 0 assertions |
| `B-007` regression/gates | coverage、full local/CI/current-head review |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)src/hooks/use_latest_request_generation.ts' \
  ':(exclude)src/App.tsx' \
  ':(exclude)src/components/CodexPanel.tsx' \
  ':(exclude)src/components/CursorPanel.tsx' \
  ':(exclude)src/components/AntigravityPanel.tsx' \
  ':(exclude)src/components/CostSummarySection.tsx' \
  ':(exclude)tests/latest_request_generation.test.ts' \
  ':(exclude)tests/provider_refresh_races.test.tsx' \
  ':(exclude)scripts/check_latest_request_wiring.mjs' \
  ':(exclude)scripts/check_latest_request_wiring.test.mjs' \
  ':(exclude)package.json' \
  ':(exclude)package-lock.json' \
  ':(exclude)specs/GH52/tasks.md'
node -e "
  const manifest = require('./package.json');
  if (manifest.dependencies?.['react-test-renderer'] || manifest.dependencies?.['@types/react-test-renderer']) process.exit(1);
  if (!manifest.devDependencies?.['react-test-renderer'] || !manifest.devDependencies?.['@types/react-test-renderer']) process.exit(1);
  const lock = require('./package-lock.json');
  const react = lock.packages?.['node_modules/react']?.version;
  const renderer = lock.packages?.['node_modules/react-test-renderer']?.version;
  if (!react || renderer !== react) process.exit(1);
"
node --experimental-test-coverage \
  --test-coverage-include=scripts/check_latest_request_wiring.mjs \
  --test-coverage-lines=100 \
  --test-coverage-functions=100 \
  --test-coverage-branches=100 \
  --test scripts/check_latest_request_wiring.test.mjs
node scripts/check_latest_request_wiring.mjs
npx vitest run tests/latest_request_generation.test.ts tests/provider_refresh_races.test.tsx
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
  --critical src/hooks/use_latest_request_generation.ts=100 \
  --critical src/App.tsx=100 \
  --critical src/components/CodexPanel.tsx=100 \
  --critical src/components/CursorPanel.tsx=100 \
  --critical src/components/AntigravityPanel.tsx=100 \
  --critical src/components/CostSummarySection.tsx=100
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Rollback Plan

回滚 implementation PR。无 backend、schema、payload、interval、cache 或 runtime dependency migration；旧请求将恢复无条件 commit 行为。

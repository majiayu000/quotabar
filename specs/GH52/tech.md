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

实现变量名固定为：App `claude_request_generation`；Codex/Cursor/Antigravity `request_generation`；Cost `overview_generation` 与 `daily_generation`。Test Plan 使用 TypeScript AST 验证每个 owner 的 hook call exact count，且每个 generation object 都实际调用一个 `begin()` 与至少三个 `isCurrent(generation)` terminal guards，禁止只 import/声明但不接线。

### 3. Cost lanes

`CostSummarySection` 使用两个 stable generation objects：

- `overview_generation`：overview/loading/error。
- `daily_generation`：daily series/fallback。

两 lane 独立 begin/current/invalidate。effect cleanup invalidate 两者；新 effect 仍启动两 lane。overview stale finally 不清新 overview loading；daily stale error 不把新 daily 设 null。现有 merge functions 与 error message contract不变。

### 4. Tests

- `tests/latest_request_generation.test.ts`：begin monotonic、current replacement、invalidate、hook unmount cleanup，critical 100%。
- `tests/provider_refresh_races.test.tsx`：dev-only real React effects，使用 deferred promises；至少覆盖 Codex reproduction、Claude manual/background、Cursor stale failure、Antigravity unmount+interval 0、Cost overview/daily independent races。
- 每个 provider 至少同时断言 visible state 或 callback、error、loading 中适用的两个维度，禁止只测 helper。
- renderer 仅为 dev dependency，版本必须与 `package-lock.json` resolved React 版本兼容；不得进入 `dependencies`。

## Affected Files / Allowlist

- `src/hooks/use_latest_request_generation.ts`
- `src/App.tsx`
- `src/components/CodexPanel.tsx`
- `src/components/CursorPanel.tsx`
- `src/components/AntigravityPanel.tsx`
- `src/components/CostSummarySection.tsx`
- `tests/latest_request_generation.test.ts`
- `tests/provider_refresh_races.test.tsx`
- `package.json`
- `package-lock.json`
- `specs/GH52/tasks.md`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| stale finally clears new loading | current check inside finally + deferred assertion。 |
| helper tested but component not wired | real component effect tests for every owner。 |
| one provider uses separate manual guard | exact source/AST gate requires one coordinator per provider fetch owner。 |
| cost overview invalidates daily | two independent coordinator identities + cross-lane test。 |
| unmount callbacks leak | hook cleanup invalidate + deferred unmount test。 |
| current failures silently disappear | only stale failure ignored；current failure regression assertions。 |
| React test dependency drifts runtime | dev-only placement + resolved-version compatibility gate。 |
| scope expands into tray writes | allowlist + explicit non-goal。 |

## Product-to-Test Mapping

| Invariant | Verification |
| --- | --- |
| `B-001` latest success only | Codex/Claude/Cursor/Antigravity deferred old/new success |
| `B-002` stale failures ignored | provider old failure/new success and new failure/old success |
| `B-003` loading ownership | stale finally while current request pending |
| `B-004` cleanup invalidation | unmount and cost effect cleanup deferred completion |
| `B-005` lane ownership | Codex atomic bundle + cost independent lane test |
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
node --input-type=module -e "
  import ts from 'typescript';
  import { readFileSync } from 'node:fs';
  const owners = new Map([
    ['src/App.tsx', [['claude_request_generation', 1]]],
    ['src/components/CodexPanel.tsx', [['request_generation', 1]]],
    ['src/components/CursorPanel.tsx', [['request_generation', 1]]],
    ['src/components/AntigravityPanel.tsx', [['request_generation', 1]]],
    ['src/components/CostSummarySection.tsx', [['overview_generation', 1], ['daily_generation', 1]]],
  ]);
  for (const [path, expected] of owners) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let hookCalls = 0;
    const calls = new Map(expected.map(([name]) => [name, { begin: 0, current: 0 }]));
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useLatestRequestGeneration') hookCalls += 1;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        const counts = calls.get(node.expression.expression.text);
        if (counts && node.expression.name.text === 'begin') counts.begin += 1;
        if (counts && node.expression.name.text === 'isCurrent') counts.current += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (hookCalls !== expected.length) process.exit(1);
    for (const [name, beginCount] of expected) {
      const counts = calls.get(name);
      if (!counts || counts.begin !== beginCount || counts.current < 3) process.exit(1);
    }
  }
"
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
  --critical src/hooks/use_latest_request_generation.ts=100
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Rollback Plan

回滚 implementation PR。无 backend、schema、payload、interval、cache 或 runtime dependency migration；旧请求将恢复无条件 commit 行为。

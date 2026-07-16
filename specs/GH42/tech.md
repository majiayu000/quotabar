# GH-42 Tech Spec：机械 CSS 分片与双层 byte parity 门禁

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/42
- Product spec: `specs/GH42/product.md`

## Current Behavior

`src/App.tsx` 依次 import `styles.css`、`redesign.css`、`redesign-settings.css`。其中 legacy `styles.css` 为 1,906 行，源码 SHA-256 为 `b641fb7125c42c89b71f224151f990917743f82a182b08b397ccd436eecd15ac`。locked dependencies 下 `npm run build` 生成一个 52,095-byte CSS asset，SHA-256 为 `d7f90db387af5a7e53c340b02890f40f0f407def247a3cceacf6dfdad473b955`。

## Preflight Contract

implementation branch 必须从 spec/amend PR 合并后的 then-latest `origin/main` 创建，并在任何 edit 前验证：

- `src/styles.css` 恰好 1,906 行且 source hash 仍为 baseline。
- `App.tsx` CSS imports 仍精确为 `./styles.css`、`./redesign.css`、`./redesign-settings.css`。
- baseline build 仍只有一个 52,095-byte CSS asset且 hash 不变。

任一条件不符表示 main 已漂移；必须停止机械 split 并先更新 GH42 spec，不能调整边界后静默继续。

### Preflight Commands（任何 edit 前执行）

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
node --input-type=module -e "
  import { createHash } from 'node:crypto';
  import { readFileSync } from 'node:fs';
  const css = readFileSync('src/styles.css');
  const lines = css.toString('utf8').split('\n').length - 1;
  const hash = createHash('sha256').update(css).digest('hex');
  if (lines !== 1906 || hash !== 'b641fb7125c42c89b71f224151f990917743f82a182b08b397ccd436eecd15ac') process.exit(1);
"
node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  const source = readFileSync('src/App.tsx', 'utf8');
  const actual = [...source.matchAll(/^import '(.+\.css)';$/gm)].map((match) => match[1]);
  const expected = ['./styles.css', './redesign.css', './redesign-settings.css'];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) process.exit(1);
"
npm ci
npm run build
node --input-type=module -e "
  import { createHash } from 'node:crypto';
  import { readFileSync, readdirSync } from 'node:fs';
  const assets = readdirSync('dist/assets').filter((name) => name.endsWith('.css'));
  if (assets.length !== 1) process.exit(1);
  const css = readFileSync('dist/assets/' + assets[0]);
  const hash = createHash('sha256').update(css).digest('hex');
  if (css.length !== 52095 || hash !== 'd7f90db387af5a7e53c340b02890f40f0f407def247a3cceacf6dfdad473b955') process.exit(1);
"
```

## Proposed Design

### 1. 精确文件边界

不解析、不格式化 CSS，只按 LF byte boundary 移动：

| 新路径 | 原始 inclusive lines | 行数 | 职责边界 |
| --- | ---: | ---: | --- |
| `src/styles/foundation.css` | 1~726 | 726 | themes、base layout、settings/theme/tray controls、error chrome |
| `src/styles/content.css` | 727~1324 | 598 | sections、quota/progress、actions、detail/cost、toast、scrollbar |
| `src/styles/views.css` | 1325~1906 | 582 | provider tabs、overview、settings view、Codex/detail view rules |

三个文件各自保留其 range 内全部 bytes；直接拼接时不添加 separator，也不删除原 newline。完成后删除 `src/styles.css`。

### 2. Import order

`App.tsx` 的 CSS imports 必须精确为：

```ts
import './styles/foundation.css';
import './styles/content.css';
import './styles/views.css';
import './redesign.css';
import './redesign-settings.css';
```

采用 direct JS imports，让 Vite 在原 cascade position 按模块顺序合并；禁止 CSS `@import` 或 aggregator file。

### 3. Deterministic parity checks

source gate 使用 Node `readFileSync` 按指定顺序拼接 Buffer，断言：

- 每个文件 line count 精确为 726/598/582 且 ≤800。
- concatenated byte length 等于 fragments 总和。
- concatenated SHA-256 精确等于 source baseline。
- `src/styles.css` 不存在。

import gate 从 `App.tsx` 提取所有 top-level `.css` imports，数组必须与五项 expected 完全相等。

bundle gate 在 `npm run build` 后读取 `dist/assets/*.css`：必须恰好一个文件、52,095 bytes、SHA-256 精确等于 bundle baseline。该 gate 已在 disposable worktree 对 proposed split 实跑通过；不是推测值。

### 4. Coverage applicability 与回归

本变更不新增可执行 TS/TSX 行：`App.tsx` 只用三个 CSS import declaration 替换一个 CSS import，V8 LCOV 不把这些 declaration 计为 executable line。GH35 diff coverage checker 在“零 measurable added lines”时会正确 fail closed，因此不适用于本次纯 CSS/import mechanical split。禁止加入 dummy runtime code 伪造 coverage；改由 exact import array、source hash 与 production bundle hash 三重门禁覆盖全部新增/移动 bytes。

全量 `npm test`、build 与 Rust fmt/check/test 仍执行。Release Artifacts macOS/Windows 由 PR path trigger 运行，证明拆分未破坏 desktop bundle。

## Affected Files / Allowlist

- `src/App.tsx`
- `src/styles.css`（删除）
- `src/styles/foundation.css`（新增）
- `src/styles/content.css`（新增）
- `src/styles/views.css`（新增）
- `specs/GH42/tasks.md`

## Risks and Mitigations

| 风险 | 缓解措施 |
| --- | --- |
| split boundary 丢 rule/newline | inclusive ranges + exact line counts + concatenated source hash。 |
| import order 改变 cascade | exact five-import array gate + production bundle hash。 |
| formatter 顺手重排 CSS | 不运行 CSS formatter；任何 byte 变化直接 hash failure。 |
| Vite 多 asset 或 minified bytes 漂移 | locked dependencies、exact asset count/size/hash gate。 |
| spec review 期间 main CSS 变化 | edit 前 preflight；漂移时先更新 spec，禁止旧 baseline。 |
| diff checker 对零 executable additions fail closed | 明确判定 N/A；不加 dummy code，使用 source/import/bundle parity + 全量 tests。 |
| scope 顺便扩大到 redesign/App split | 6-path allowlist fail closed；Non-Goals 明确排除。 |

## Product-to-Test Mapping

| Invariant | Implementation | Verification |
| --- | --- | --- |
| `B-001` source byte parity | ordered fragments | concatenated SHA-256 exact |
| `B-002` ceiling/boundaries | 726/598/582 files | exact line counts、≤800、section starts |
| `B-003` cascade order | App direct imports | exact CSS import array |
| `B-004` bundle parity | Vite ordered merge | one asset、52,095 bytes、bundle SHA exact |
| `B-005` scope/regression | mechanical diff only | allowlist、零 executable TS additions、full frontend/Rust/CI |
| `B-006` latest-main safety | preflight before edits | original source/import/build baselines exact |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)src/App.tsx' \
  ':(exclude)src/styles.css' \
  ':(exclude)src/styles/foundation.css' \
  ':(exclude)src/styles/content.css' \
  ':(exclude)src/styles/views.css' \
  ':(exclude)specs/GH42/tasks.md'
test ! -e src/styles.css
node --input-type=module -e "
  import { createHash } from 'node:crypto';
  import { readFileSync } from 'node:fs';
  const paths = ['src/styles/foundation.css', 'src/styles/content.css', 'src/styles/views.css'];
  const expectedLines = [726, 598, 582];
  const buffers = paths.map((path) => readFileSync(path));
  buffers.forEach((buffer, index) => {
    const lines = buffer.toString('utf8').split('\n').length - 1;
    if (lines !== expectedLines[index] || lines > 800) process.exit(1);
  });
  const hash = createHash('sha256').update(Buffer.concat(buffers)).digest('hex');
  if (hash !== 'b641fb7125c42c89b71f224151f990917743f82a182b08b397ccd436eecd15ac') process.exit(1);
"
node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  const source = readFileSync('src/App.tsx', 'utf8');
  const actual = [...source.matchAll(/^import '(.+\.css)';$/gm)].map((match) => match[1]);
  const expected = ['./styles/foundation.css', './styles/content.css', './styles/views.css', './redesign.css', './redesign-settings.css'];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) process.exit(1);
"
npm test
npm run build
node --input-type=module -e "
  import { createHash } from 'node:crypto';
  import { readFileSync, readdirSync } from 'node:fs';
  const assets = readdirSync('dist/assets').filter((name) => name.endsWith('.css'));
  if (assets.length !== 1) process.exit(1);
  const css = readFileSync('dist/assets/' + assets[0]);
  const hash = createHash('sha256').update(css).digest('hex');
  if (css.length !== 52095 || hash !== 'd7f90db387af5a7e53c340b02890f40f0f407def247a3cceacf6dfdad473b955') process.exit(1);
"
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Rollback Plan

回滚 implementation PR。该变更无 selector、bundle byte、dependency、config 或 data migration；revert 会恢复单一 `src/styles.css` import。

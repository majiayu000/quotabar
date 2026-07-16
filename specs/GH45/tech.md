# GH-45 Tech Spec：机械拆分 redesign CSS 与 byte parity 门禁

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/45
- Product spec: `specs/GH45/product.md`

## Current Behavior

`src/App.tsx` 在三个 legacy fragments 后 import `redesign.css`，再 import `redesign-settings.css`；baseline App 为 26,016 bytes、SHA-256 `07386d4067506970aee19e7573b7599579235918a929e963e9f48cf331435d5a`。`redesign.css` 为 861 行、15,665 bytes，SHA-256 `9f539903e5596a3911ea6b383bba3f5b3e8720ad8bc2286205cb5ccb6e25c9c0`。locked dependencies 下 production build 生成一个 52,095-byte CSS asset，SHA-256 `d7f90db387af5a7e53c340b02890f40f0f407def247a3cceacf6dfdad473b955`。

## Preflight Contract

implementation branch 必须从 spec/amend PR 合并后的 then-latest `origin/main` 创建，并在任何 edit 前验证：

- `src/redesign.css` 恰好 861 行、15,665 bytes，source hash 仍为 baseline。
- `App.tsx` 仍为 26,016 bytes/App SHA exact；全部含 `.css` 的 lines 仍精确为三个 legacy fragments、`./redesign.css`、`./redesign-settings.css` 的五个单引号 side-effect imports。
- baseline build 仍只有一个 52,095-byte CSS asset 且 hash 不变。

任一条件不符表示 main 已漂移；必须停止 mechanical split 并先更新 GH45 spec。

### Preflight Commands（任何 edit 前执行）

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
node --input-type=module -e "
  import { createHash } from 'node:crypto';
  import { readFileSync } from 'node:fs';
  const css = readFileSync('src/redesign.css');
  const lines = css.toString('utf8').split('\n').length - 1;
  const hash = createHash('sha256').update(css).digest('hex');
  if (lines !== 861 || css.length !== 15665 || hash !== '9f539903e5596a3911ea6b383bba3f5b3e8720ad8bc2286205cb5ccb6e25c9c0') process.exit(1);
"
node --input-type=module -e "
  import { createHash } from 'node:crypto';
  import { readFileSync } from 'node:fs';
  const app = readFileSync('src/App.tsx');
  const hash = createHash('sha256').update(app).digest('hex');
  if (app.length !== 26016 || hash !== '07386d4067506970aee19e7573b7599579235918a929e963e9f48cf331435d5a') process.exit(1);
  const actual = app.toString('utf8').split('\n').filter((line) => line.includes('.css'));
  const expected = [
    "import './styles/foundation.css';",
    "import './styles/content.css';",
    "import './styles/views.css';",
    "import './redesign.css';",
    "import './redesign-settings.css';",
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) process.exit(1);
"
node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  const baseline = readFileSync('src/App.tsx', 'utf8');
  const anchor = "import './redesign-settings.css';";
  if (baseline.split(anchor).length !== 2) process.exit(1);
  const adversarial = baseline.replace(anchor, anchor + '\nimport "./redesign-settings.css";');
  const actual = adversarial.split('\n').filter((line) => line.includes('.css'));
  const expected = baseline.split('\n').filter((line) => line.includes('.css'));
  if (JSON.stringify(actual) === JSON.stringify(expected)) process.exit(1);
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
| `src/redesign/shell.css` | 1~223 | 223 | app/theme chrome、container、command bar、provider navigation/cards |
| `src/redesign/panels.css` | 224~861 | 638 | detail、quota、bonus、timeline、cost、budget、sparkline、actions |

第 224 行是完整 selector list 前的原始空行；shell 结束于第 223 行完整 `provider-card-percent` rule。两个文件保留 range 内全部 bytes，直接拼接时不添加 separator；完成后删除 `src/redesign.css`。

### 2. Import order

`App.tsx` 的全部 CSS imports 必须精确为：

```ts
import './styles/foundation.css';
import './styles/content.css';
import './styles/views.css';
import './redesign/shell.css';
import './redesign/panels.css';
import './redesign-settings.css';
```

采用 direct JS imports，让 Vite 在原 cascade position 按模块顺序合并；禁止 CSS `@import` 或 aggregator file。

### 3. Deterministic parity checks

source gate 按 shell → panels 读取 Buffer，断言 223/638 lines、15,665 bytes、SHA exact、旧文件不存在。preflight 先锁定完整 baseline App bytes/hash，并把 App 中每一行含 `.css` 的内容与 exact five-line array 比较，因此双引号、default/dynamic/multiline CSS import、额外 CSS reference 或格式漂移都会 fail closed。implementation App gate 再从 `git show origin/main:src/App.tsx` 读取该 baseline，要求旧 redesign import 唯一，仅做规定 1→2 replacement，并断言 current App bytes 等于 computed expected；最后把全部含 `.css` 的 App lines 与 exact six-line array 比较。bundle gate 要求 `npm run build` 后恰好一个 52,095-byte CSS asset 且 SHA exact。

adversarial gate 必须用 in-memory counterexample 证明：在 baseline App 插入 `import "./redesign-settings.css";` 时，完整 App hash 与 exact `.css` line array 至少一个失败；不得依赖 Vite 对重复 module 的 bundle deduplication。

以上 source/App/import/bundle gates 已在 disposable worktree 实跑通过，且 candidate `git diff --check` 通过。

### 4. Coverage applicability 与回归

App exact replacement gate 证明本变更不新增 executable TS/TSX，只增加一个 CSS import declaration；V8 LCOV 不把这些 declaration 计为 executable line。GH35 diff checker 对零 measurable added lines 会 fail closed，因此本次 coverage 为 N/A。禁止加入 dummy runtime code；由 exact App bytes、source bytes/hash、import array 与 production bundle parity 覆盖全部新增/移动 bytes。

全量 `npm test`、build 与 Rust fmt/check/test 仍执行。Release Artifacts macOS/Windows 由 PR path trigger 运行。

## Affected Files / Allowlist

- `src/App.tsx`
- `src/redesign.css`（删除）
- `src/redesign/shell.css`（新增）
- `src/redesign/panels.css`（新增）
- `specs/GH45/tasks.md`

## Risks and Mitigations

| 风险 | 缓解措施 |
| --- | --- |
| split boundary 拆开 selector/rule | boundary 在第 223 行完整 rule 后；line counts + source byte/hash gate。 |
| 双引号/额外/非标准 CSS import 被 narrow regex 忽略 | preflight full App bytes/hash + every `.css` line exact array；final exact App replacement + every `.css` line six-item array。 |
| import order 改变 cascade | exact App replacement + six-line array + production bundle hash。 |
| App allowlist 混入 executable/formatting edit | 从 `origin/main:src/App.tsx` computed exact replacement；current bytes 完全相等。 |
| formatter 改写 CSS | 不运行 CSS formatter；source byte/hash fail closed。 |
| Vite asset 漂移 | locked dependencies、exact asset count/size/hash gate。 |
| spec review 期间 main 漂移 | edit 前 preflight；漂移时先更新 spec。 |
| coverage checker 对零 executable additions fail closed | 明确 N/A；不加 dummy code，使用 exact parity + 全量 tests。 |
| scope 扩大到 settings/App/legacy cleanup | 5-path allowlist 与 Non-Goals fail closed。 |

## Product-to-Test Mapping

| Invariant | Implementation | Verification |
| --- | --- | --- |
| `B-001` source byte parity | ordered fragments | 15,665 bytes + SHA exact |
| `B-002` ceiling/boundaries | 223/638 files | exact line counts、≤800、完整 rule boundary |
| `B-003` cascade order | App direct imports | origin/main exact replacement + every `.css` line six-item array |
| `B-004` bundle parity | Vite ordered merge | one asset、52,095 bytes、bundle SHA exact |
| `B-005` scope/regression | mechanical diff only | allowlist、coverage N/A evidence、full frontend/Rust/CI |
| `B-006` latest-main safety | preflight before edits | source/App/import/build baselines exact |

## Test Plan

```bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD
git diff --quiet origin/main...HEAD -- . \
  ':(exclude)src/App.tsx' \
  ':(exclude)src/redesign.css' \
  ':(exclude)src/redesign/shell.css' \
  ':(exclude)src/redesign/panels.css' \
  ':(exclude)specs/GH45/tasks.md'
test ! -e src/redesign.css
node --input-type=module -e "
  import { createHash } from 'node:crypto';
  import { readFileSync } from 'node:fs';
  const paths = ['src/redesign/shell.css', 'src/redesign/panels.css'];
  const expectedLines = [223, 638];
  const buffers = paths.map((path) => readFileSync(path));
  buffers.forEach((buffer, index) => {
    const lines = buffer.toString('utf8').split('\n').length - 1;
    if (lines !== expectedLines[index] || lines > 800) process.exit(1);
  });
  const concatenated = Buffer.concat(buffers);
  const hash = createHash('sha256').update(concatenated).digest('hex');
  if (concatenated.length !== 15665 || hash !== '9f539903e5596a3911ea6b383bba3f5b3e8720ad8bc2286205cb5ccb6e25c9c0') process.exit(1);
"
node --input-type=module -e "
  import { execFileSync } from 'node:child_process';
  import { readFileSync } from 'node:fs';
  const baseline = execFileSync('git', ['show', 'origin/main:src/App.tsx'], { encoding: 'utf8' });
  const oldImport = "import './redesign.css';";
  if (baseline.split(oldImport).length !== 2) process.exit(1);
  const replacement = ["import './redesign/shell.css';", "import './redesign/panels.css';"].join('\n');
  const expected = baseline.replace(oldImport, replacement);
  if (readFileSync('src/App.tsx', 'utf8') !== expected) process.exit(1);
"
node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  const source = readFileSync('src/App.tsx', 'utf8');
  const actual = source.split('\n').filter((line) => line.includes('.css'));
  const expected = [
    "import './styles/foundation.css';",
    "import './styles/content.css';",
    "import './styles/views.css';",
    "import './redesign/shell.css';",
    "import './redesign/panels.css';",
    "import './redesign-settings.css';",
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) process.exit(1);
"
git diff --check origin/main...HEAD
npm test
npx vitest run --coverage \
  --coverage.include='src/**/*.{ts,tsx}' \
  --coverage.reporter=lcov \
  --coverage.reporter=text
set +e
coverage_output=$(node scripts/check_ts_diff_coverage.mjs \
  --base origin/main \
  --lcov coverage/lcov.info \
  --minimum 80 2>&1)
coverage_status=$?
set -e
test "$coverage_status" -ne 0
case "$coverage_output" in
  *"diff contains no measurable TypeScript lines"*) ;;
  *) printf '%s\n' "$coverage_output" >&2; exit 1 ;;
esac
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

回滚 implementation PR。该变更无 selector、bundle byte、dependency、config 或 data migration；revert 会恢复单一 `src/redesign.css` import。

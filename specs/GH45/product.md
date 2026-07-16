# GH-45 Product Spec：无输出漂移地拆分超限 redesign stylesheet

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/45
- `complexity: medium`

## 背景

`origin/main@e627b1dd33335c262c4a730e84151d436953679b` 的 `src/redesign.css` 有 861 行，超过仓库 800 行 hard ceiling 61 行。app/provider shell 与 detail、quota、cost、budget、action panels 共用一个 mutation surface，扩大 review ownership 与 cascade drift 风险。

一次 disposable worktree 实测已证明：在原第 223 行后按完整 rule 边界拆为 223/638 行并保持 import 顺序时，两段拼接仍为原 15,665 bytes、SHA-256 `9f539903e5596a3911ea6b383bba3f5b3e8720ad8bc2286205cb5ccb6e25c9c0`，Vite production CSS 仍为单一 52,095-byte asset、SHA-256 `d7f90db387af5a7e53c340b02890f40f0f407def247a3cceacf6dfdad473b955`；`git diff --check` 也通过。

## Goals

- 把 861 行 redesign monolith 拆为 shell 与 panels 两个职责清晰且不超过 800 行的 CSS module。
- 保留所有 comment、selector、declaration、whitespace、rule order 与 newline bytes；不引入视觉或 cascade 变化。
- 保持 redesign modules 在三个 legacy modules 之后、`redesign-settings.css` 之前的原 cascade position。
- 用 source concatenation、exact App replacement 与 production bundle hash/size 证明无漂移。
- 缩小后续 redesign CSS review 与修改范围，不改变 runtime、依赖或 desktop bundle 行为。

## Non-Goals

- 不重命名、合并、删除或格式化任何 CSS selector/declaration/token/comment。
- 不修改 legacy style fragments、`redesign-settings.css`、组件、Rust 或 build config。
- 不使用 CSS `@import`，不改变 Vite CSS pipeline、minifier 或 dependency。
- 不同时拆分 `App.tsx`，不做 CSS deduplication、dead-style cleanup 或 visual redesign。

## Behavior Invariants

1. `B-001` shell → panels 拼接后必须与删除前 `src/redesign.css` byte-identical：15,665 bytes，SHA-256 `9f539903e5596a3911ea6b383bba3f5b3e8720ad8bc2286205cb5ccb6e25c9c0`。
2. `B-002` 两个文件行数必须分别为 223、638 且都不超过 800；shell 精确保留原 1~223 行，panels 保留 224~861 行，不能拆开 CSS rule 或 selector list。
3. `B-003` `App.tsx` 的全部 CSS import 顺序必须精确为 foundation、content、views、redesign shell、redesign panels、`redesign-settings.css`，不得插入 `@import` 或其他 CSS import。
4. `B-004` production build 必须继续只生成一个 CSS asset，大小 52,095 bytes、SHA-256 `d7f90db387af5a7e53c340b02890f40f0f407def247a3cceacf6dfdad473b955`。
5. `B-005` implementation 只允许机械文件拆分与 import replacement；frontend tests/build、Rust fmt/check/test、零 executable TS coverage applicability evidence、current-head reviews、CI 与 reviewThreads 必须通过。
6. `B-006` implementation 开始前必须重新验证 then-latest `origin/main` 的 redesign source bytes/hash/line count、CSS import baseline 与 production bundle；任一漂移都必须先更新 issue/spec。

## Acceptance Criteria

- 删除 `src/redesign.css`，新增 `src/redesign/shell.css` 与 `src/redesign/panels.css`。
- shell 精确保留原第 1~223 行，panels 保留第 224~861 行；不增删或移动分隔 newline。
- `App.tsx` 用两个 direct CSS imports 替换唯一 `./redesign.css` import，并保持在 `redesign-settings.css` 之前。
- source byte length/hash、两个 line count、App bytes/import sequence、production bundle size/hash 均由 deterministic command fail closed 验证。
- implementation diff 仅含 tech spec allowlist 的 5 个路径；没有 CSS semantic、config、dependency 或其他 App change。
- implementation 不新增可执行 TS/TSX 行；当前 App 必须等于 `origin/main:src/App.tsx` 仅执行唯一 1→2 import replacement 后的 computed expected。禁止为制造 measurable coverage 添加 dummy runtime code。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| Empty / missing input | 任一 fragment 缺失、为空或行数漂移会使 line/hash gate 失败。 |
| Error and failure paths | source、App、import、asset count/size/hash 任一不符均 non-zero；禁止 warning 后继续。 |
| Authorization / permission | 仅仓库内 CSS/import 机械移动，不触及 credential、network 或用户数据。 |
| Concurrency / race / ordering | CSS cascade 依赖 source order；用 exact App/import 与 bundle hash 门禁。 |
| Retry / repetition / idempotency | 同一 locked dependency/source 重复 build 应产生相同 CSS bytes。 |
| Illegal state transitions | 旧文件与 fragments 同时存在、`@import`、fragment >800 或多 CSS asset 均非法。 |
| Compatibility / migration | source stream 与 bundle byte-identical；无 data/API migration。 |
| Degradation / fallback | 不接受视觉抽查代替 exact byte parity。 |
| Evidence and audit integrity | baseline、candidate reproduction 与 current-head CI 都必须有新鲜证据。 |
| Cancellation / interruption / partial completion | 只完成一个 fragment/import 即未完成；rollback 为整 PR revert。 |

## Open Questions

- 无。路径、边界、顺序与 parity baseline 均已由 disposable build 验证。

# GH-42 Product Spec：无输出漂移地拆分超大 legacy stylesheet

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/42
- `complexity: medium`

## 背景

`origin/main@3b7177be1cdeca3050803875433998aaf829053a` 的 `src/styles.css` 有 1,906 行，超过仓库 800 行 hard ceiling 1,106 行。theme/base controls、quota/cost components、provider navigation、overview/settings 和 Codex panel 规则共享一个 mutation surface，扩大了 review ownership 与 cascade drift 风险。

一次 disposable worktree 实测已证明：按现有 section 边界拆为 726/598/582 行并保持 import 顺序时，三段拼接仍是原源码 SHA-256 `b641fb7125c42c89b71f224151f990917743f82a182b08b397ccd436eecd15ac`，Vite 构建产物仍为 52,095 bytes、SHA-256 `d7f90db387af5a7e53c340b02890f40f0f407def247a3cceacf6dfdad473b955`。

## Goals

- 把 1,906 行 monolith 拆为 foundation、content、views 三个职责清晰且不超过 800 行的 CSS module。
- 保留所有 comment、selector、declaration、whitespace、rule order 与 newline bytes；不引入任何视觉或 cascade 变化。
- 保持 legacy modules 在 `redesign.css`、`redesign-settings.css` 之前的原位置。
- 用 source concatenation 与 production bundle 两层 hash/size 证据证明无漂移。
- 缩小后续 CSS review 与修改范围，不改变 runtime、依赖或桌面 bundle 行为。

## Non-Goals

- 不重命名、合并、删除或格式化任何 CSS selector/declaration/token/comment。
- 不拆分或修改 `redesign.css`、`redesign-settings.css`、组件、Rust 或 build config。
- 不使用 CSS `@import`，不改变 Vite CSS pipeline、minifier 或 dependency。
- 不同时拆分 `App.tsx`，不做 CSS deduplication、dead-style cleanup 或 visual redesign。

## Behavior Invariants

1. `B-001` 三个新文件按 foundation → content → views 拼接后必须与删除前 `src/styles.css` byte-identical，SHA-256 精确为 `b641fb7125c42c89b71f224151f990917743f82a182b08b397ccd436eecd15ac`。
2. `B-002` 三个文件行数必须分别为 726、598、582，且都不超过 800 行；边界必须落在既有 section comment 之间，不能拆开 CSS rule。
3. `B-003` `App.tsx` 的全部 CSS import 顺序必须精确为 foundation、content、views、`redesign.css`、`redesign-settings.css`，不得插入 `@import` 或其他 CSS import。
4. `B-004` production build 必须继续只生成一个 CSS asset，大小精确为 52,095 bytes，SHA-256 精确为 `d7f90db387af5a7e53c340b02890f40f0f407def247a3cceacf6dfdad473b955`。
5. `B-005` implementation 只允许机械文件拆分与 import replacement；frontend tests/build、Rust fmt/check/test、零 executable TS coverage applicability evidence、current-head reviews、CI 与 reviewThreads 必须通过。
6. `B-006` implementation 开始前必须重新验证 then-latest `origin/main` 的 source hash、line count 与 CSS import baseline；任一漂移都必须先更新 issue/spec，禁止把旧边界或 hash 套到新 main。

## Acceptance Criteria

- 删除 `src/styles.css`，新增 `src/styles/foundation.css`、`src/styles/content.css`、`src/styles/views.css`。
- foundation 精确保留原第 1~726 行，content 保留第 727~1324 行，views 保留第 1325~1906 行；不增删分隔 newline。
- `App.tsx` 用三个 direct JS CSS import 替换原 `./styles.css` import，并保持在两个 redesign imports 之前。
- source concatenation hash、三个 line count、App import sequence 与 production bundle hash/size 均由 deterministic command fail closed 验证。
- implementation diff 仅含 tech spec allowlist 的 6 个路径；没有 CSS semantic diff、build config 或依赖变化。
- implementation 不新增可执行 TS/TSX 行；App 仅替换 CSS import declaration，CSS bytes 由 source/import/bundle parity 覆盖。禁止为制造 measurable coverage 添加 dummy runtime code。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| Empty / missing input | 任一 fragment 缺失或为空会使 line/hash gate 失败。 |
| Error and failure paths | hash、line、import、asset count/size 任一不符均 non-zero；禁止 warning 后继续。 |
| Authorization / permission | 仅仓库内 CSS/import 机械移动，不触及 credential、network 或用户数据。 |
| Concurrency / race / ordering | CSS cascade 依赖 source order；以 exact import sequence 与 bundle hash 双门禁。 |
| Retry / repetition / idempotency | 同一 locked dependency/source 重复 build 应产生相同 CSS bytes。 |
| Illegal state transitions | 旧文件与新 fragments 同时存在、`@import`、fragment >800 或多 CSS asset 均非法。 |
| Compatibility / migration | byte-identical source stream 与 bundle；无 data/API migration。 |
| Degradation / fallback | 不接受“视觉上看起来相同”；必须 hash/size 精确相同。 |
| Evidence and audit integrity | baseline、source、bundle 与 current-head CI 都要有新鲜命令证据。 |
| Cancellation / interruption / partial completion | 只完成部分 fragment/import 即未完成；rollback 为整 PR revert。 |

## Open Questions

- 无。边界、文件名、顺序与 parity baseline 均已由 disposable build 验证。

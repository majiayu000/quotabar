# GH-48 Product Spec：通知成功送达后才提交去重状态

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/48
- `complexity: high`

## Problem

当前 `notify()` 在权限检查、plugin load 与 `sendNotification` 之前调用会写入 storage 的 `shouldNotify()`。权限拒绝或 send 抛错时，通知没有送达，却已被 12 小时 dedupe 抑制。`origin/main@dd69b97d391f84b19c4000e817615bfb0028203c` 的 disposable tests 已复现 denial 与 send failure 两条路径均为“0 delivery + next attempt false”。

## Goals

- 把 eligibility read 与 successful-delivery commit 分离。
- 权限拒绝、permission API/plugin/send 失败均不提交 dedupe，且同 body 后续可重试。
- 同 body 并发调用至多实际发送一次。
- 成功发送后才写入 timestamp；12 小时窗口与跨 body 行为不变。
- post-send storage write 失败时保留 session shadow，避免同 session 重复发送。
- 以 typed outcome 与固定安全消息让调用方把失败写入现有 event feed；不吞异常、不泄露原始 error。

## Non-Goals

- 不改变 12 小时窗口、threshold、通知标题/body 文案或 OS permission policy。
- 不自动打开系统设置，不重构 storage adapter/event schema/App 架构。
- 不为 browser preview 发送通知，不加入依赖或 build config。

## Behavior Invariants

1. `B-001` eligibility 必须只读；missing/expired 为 eligible，recent 为 duplicate，access/decode failure 为 failure，均不得在 send 前写 dedupe。
2. `B-002` permission denied、permission API/plugin/send failure 必须返回 typed failure、零 dedupe commit、释放 in-flight；下一次同 body 可重新尝试。
3. `B-003` 只有 `sendNotification` 无异常返回后才记录 body timestamp；commit 必须 fresh read/merge/prune，防止不同 body 并发 lost update。窗口内同 body duplicate 不发送，不同 body 独立且最终都保留。
4. `B-004` 同 body 并发调用由 in-flight guard 合并为至多一次 send；不同 body 不互相阻塞；所有 terminal path 都释放 guard。
5. `B-005` module-local session timestamp map 在成功 send 后立即记录并按窗口 pruning；post-send fresh-read 或 persistent write failure 时仍保持本 session dedupe，delivery outcome 为 sent，既不伪称未送达也不重复发送。
6. `B-006` backend unavailable/recent duplicate 返回 typed skipped；permission/dedupe/delivery failure 返回固定无敏感信息的 failure，并通过 `on_failure` 写入 event feed；全量、coverage 与 PR gates 通过。

## Acceptance Criteria

- `shouldNotify(body, now)` 变为 read-only，不再调用 `localStorage.setItem`。
- `notify` 返回 discriminated union `sent | skipped | failure`；公开类型无 `any`。
- failure message 只使用固定常量，不包含 title/body、storage key、原始 exception 或 token。
- notification dedupe 的 post-send storage write failure 只输出固定 `Failed to persist local setting.`，不得把原始 storage `Error` 对象或 message 传给 console；其他 storage callers 的既有 logging contract 不变。
- App bonus 与 service 80%/95% 三个 callers 全部通过同一 tested failure-options helper 传入 `on_failure`；TypeScript AST gate 证明三个 callsite 的第三参数 exact，helper callback 只调用 `logEvent('critical', fixedMessage)` 且零递归 notify。
- deterministic tests 覆盖 success/deduped/different body、denial、permission throw、send throw、concurrency、read failure、malformed state、post-send write failure/session shadow、failure callback 与 retry。
- implementation 仅含 tech spec 9-path allowlist；新增 executable TS/TSX ≥80%，`notifications.ts` 新增 critical paths 100%。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| Missing/corrupt storage | missing eligible；corrupt/access failure fail closed 且 failure visible。 |
| Permission | denied/throw 均不得 commit；later retry eligible。 |
| Delivery | send throw 不 commit；success 后才 commit。 |
| Concurrency | same body at most one send；finally release。 |
| Persistence | post-send write failure uses session shadow；restart may retry但 current session不重复；notification path 仅固定安全日志。 |
| Compatibility | window/body identity/settings/defaults unchanged。 |
| Degradation | 禁止 console-only catch + fake dedupe success。 |
| Evidence | failure matrix、coverage、full local/CI/current-head review。 |

## Open Questions

- 无。失败语义、commit point、concurrency 与 caller visibility 均已定义。

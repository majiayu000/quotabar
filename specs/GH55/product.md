# GH-55 Product Spec：popover visibility 失败必须可观察且 fail closed

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/55
- `complexity: medium`

## Problem

`usePopoverWindow` 把 Tauri `isVisible()` 与 `onFocusChanged()` 注册失败静默转换为 `windowVisible=true`。未知状态因此被伪装成已确认可见，使隐藏窗口仍可能启用 provider polling、cost reads 与 tray synchronization。focus callback 也没有 mounted guard，cleanup 后仍存在 late callback 写 state 的窗口。

`origin/main@1b2c0505f7752dfc745237da32c40a962569ff8c` 的 disposable real-React reproduction 已确认：`isVisible()` rejection 后 render sequence 为 `[false, true]`，且没有包含该失败的 error record。临时测试已删除，审计 worktree 恢复干净。

## Goals

- Tauri visibility 未知或失败时保持 `false`，绝不提升为 visible。
- visibility read 与 focus subscription 失败使用固定安全 `console.error` message，可观察但不泄漏原始 error。
- mounted focus event 是最新 authoritative visibility；较晚 initial read 不得覆盖它。
- cleanup 后的 promise terminal、focus callback 与 listener registration 不得写 state 或泄漏 listener。
- browser/non-Tauri 路径继续直接 visible；已知 Tauri visibility、resize 与 polling cadence 保持兼容。

## Non-Goals

- 不改变 Tauri/backend API、provider payload、polling intervals、cost aggregation 或 tray writes。
- 不新增 user-facing notification/error UI。
- 不重构 resize behavior、App routing 或其他 hooks。
- 不新增 runtime/dev dependency。

## Behavior Invariants

1. `B-001` browser/non-Tauri 环境直接设置 visible `true`，且不调用 Tauri window APIs。
2. `B-002` mounted 时 `isVisible()` success 精确提交 boolean；sync throw 或 rejection 记录一次固定安全 read error，并 fail closed 为 `false`。
3. `B-003` mounted focus callback 设置 authoritative boolean；一旦观察到 focus event，较晚 initial read success/failure 不得改变该 state。
4. `B-004` focus subscription sync throw 或 rejection 记录一次固定安全 subscription error，并 fail closed 为 `false`；该 failure 成为 authoritative，较晚 initial read 不得重新提升 visibility。
5. `B-005` cleanup 后 late read success/rejection、subscription rejection 与 focus callback 均零 state write、零 error log；late subscription resolution 必须立即调用 returned unlisten exactly once。
6. `B-006` 正常 cleanup 对已注册 listener 调用 unlisten exactly once；callback 与 cleanup 不得产生 duplicate stop。
7. `B-007` 固定 error messages 不包含原始 Error object、message、stack 或任意 payload；同一 terminal failure 只记录一次。
8. `B-008` deterministic real-React matrix、diff coverage、full frontend/build/Rust 与 current-head PR gates 全部通过，且 implementation 无 allowlist 外 scope。

## Acceptance Criteria

- real hook tests 覆盖 browser path、initial visible/hidden success、read rejection、read sync throw、focus true/false events、subscription rejection、subscription sync throw。
- race tests 覆盖 focus event 后 late read `true`、`false` 与 rejection，以及 subscription failure 后 late read success/rejection；authoritative focus/failure state 不被 initial read 覆盖。
- cleanup tests 分别覆盖 late read resolve/reject、late subscription resolve/reject、focus callback after cleanup；state/log/unlisten counts 精确。
- 两条 failure messages 固定为：`Failed to read popover window visibility` 与 `Failed to subscribe to popover focus changes`。
- failure tests 断言原始 error text/object 不出现在任意 `console.error` arguments；browser 与 cleanup-stale terminal 不记录 error。
- public hook signature 与 resize behavior 不变；production/runtime dependencies 不变。
- implementation 仅含 tech spec allowlist；executable TS/TSX diff line coverage ≥80%，`src/hooks/use_popover_window.ts` measurable changed lines critical 100%。

## Boundary Checklist

| Boundary | Expected result |
| --- | --- |
| Browser/non-Tauri | visible=true；零 Tauri calls。 |
| Initial visible/hidden | 精确提交 backend boolean。 |
| Initial read throw/reject | 固定安全 log 一次；visible=false。 |
| Focus true/false | mounted 时精确提交并成为 authoritative。 |
| Read finishes after focus | read terminal 不覆盖 focus state。 |
| Subscription throw/reject | 固定安全 log 一次；visible=false；late read 不得重新提升。 |
| Cleanup before read terminal | 零 state/log。 |
| Cleanup before listener resolves | late unlisten exactly once。 |
| Focus callback after cleanup | 零 state/log。 |

## Open Questions

- 无。fail-closed state、event precedence、safe logging、cleanup 与测试边界均已定义。

# GH-58 Product Spec：fatal frontend diagnostics 安全、可见且单实例

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/58
- `complexity: medium`

## Problem

`src/main.tsx` 把 window error、unhandled rejection 与 React uncaught error 的任意 payload 原样传给 `console.error`，并把 `Error.message` / `Error.stack` 或 `String(payload)` 写进透明 popover DOM。OAuth 片段、本地路径、响应内容等敏感上下文因此可能进入日志与截图；异常 `toString` 还可能让 fatal reporter 自身抛错。DOM fallback 的空 `catch {}` 会吞掉 create/update/append failure，使 blank-panel 症状继续无独立 reporter 信号。重复 fatal channel 还会追加多个全屏 `<pre>`。

`origin/main@db883cd42eb466fd41f84e920cf6b4579ec94ef1` 的 disposable entry-module reproduction 已确认：带 `oauth_token=private-fatal-payload` 与 private stack marker 的 Error 同时出现在 console arguments 和 `<pre>.textContent`；`appendChild` 抛错后 handler 静默返回，且没有固定 reporter-failure message。临时测试已删除，audit worktree 恢复干净。

## Goals

- 三个 fatal channel 只输出固定安全诊断，不读取、转换、序列化或转发 raw payload。
- 透明 popover 继续绘制明确、通用的重启提示，并保留安全的内部 source 标识。
- 所有 fatal channel 复用一个固定 ID 的 surface，不追加重复 overlay。
- fatal surface 的 lookup/create/update/append failure 使用固定安全 secondary diagnostic，可观察且不泄漏 raw 值。
- 保持 React root、window listeners 与正常 App render wiring 不变。

## Non-Goals

- 不新增 telemetry、remote reporting、crash persistence、user notification 或 error details UI。
- 不改 App、backend、Tauri API、provider、storage、polling、notification 或 styling system。
- 不展示 stack、error message、本地路径、payload 摘要或 debug token。
- 不新增 runtime/dev dependency。

## Behavior Invariants

1. `B-001` module startup 精确注册一次 window `error` listener、一次 `unhandledrejection` listener，并以 React 19 `onUncaughtError` 创建与 render 现有 root/App。
2. `B-002` 每次 window、promise 或 React fatal event 精确记录一次 source-specific fixed primary string；console arguments 不含 raw identity、message、stack、getter/toString result 或任意 payload。
3. `B-003` 每次 fatal event 尝试把固定 generic restart instruction 与内部 source 写入固定 ID surface；DOM text 不含 raw 数据。
4. `B-004` 首次成功创建并 append 一个 `<pre>`；后续 fatal event 复用并更新同一 surface，append count 保持一次。
5. `B-005` surface lookup、create、safe-field update 或 append 任一失败时，handler 不传播该 DOM failure，精确记录一次固定 secondary string，且不传递 caught value。
6. `B-006` raw payload 永不被属性读取、字符串转换或序列化；带 throwing getter/toString 的 Error-like/object payload 也不能影响 reporter terminal。
7. `B-007` surface 只使用 `textContent`；不得出现 `innerHTML`、HTML parsing、raw error logging、empty catch 或 duplicate fatal node。
8. `B-008` deterministic entry-module matrix、diff coverage、full frontend/build/Rust 与 current-head PR gates 全部通过，implementation 无 allowlist 外 scope。

## Acceptance Criteria

- entry-module tests 捕获真实注册的 window error、unhandled rejection 与 React `onUncaughtError` callbacks，不测试复制 helper。
- 三个 channel 分别传入含 private marker 的 Error、非 Error object 与 throwing getter/toString payload；handler 不抛错，primary log 与 DOM text 仅为固定安全值。
- fixed strings 为 `Quotabar encountered an unexpected interface error. Restart the app.` 与 `Failed to display fatal frontend error.`；source 仅为 `window`、`promise`、`react`。
- 首次 fatal event 创建固定 ID `quotabar-fatal-error` 的 `<pre>`；连续三个 channel 只 append 一次，复用 surface 并更新为最后 source。
- deterministic failure matrix 覆盖 `getElementById`、`createElement`、surface id/style/text update 与 `body.appendChild` failure；每个 terminal primary/secondary 各一次、零 raw data、零 throw。
- fake surface 对 `innerHTML` write fail closed；throwing raw getters/toString 与实际 callback capture 直接证明 production path 不读取 raw event fields 或 payload。
- root lookup、`createRoot` options、`render(<StrictMode><App /></StrictMode>)` 与两个 listener registrations 精确断言。
- implementation 仅含 tech spec allowlist；executable TS/TSX diff line coverage ≥80%，`src/main.tsx` measurable changed lines critical 100%。

## Boundary Checklist

| Boundary | Expected result |
| --- | --- |
| Window Error with secret Error | fixed window log + fixed window surface；零 raw。 |
| Promise rejection object | fixed promise log + reused fixed surface；零 object access/coercion。 |
| React uncaught error | fixed react log + reused fixed surface；root wiring unchanged。 |
| Throwing getter/toString payload | handler terminal 不受影响；零 payload evaluation。 |
| First fatal event | create/initialize/append fixed-ID `<pre>` exactly once。 |
| Repeated channels | reuse same node；append count remains one。 |
| Existing fatal surface | update safe text only；不创建新 node。 |
| DOM operation failure | fixed secondary log once；零 raw/caught value；handler 不 throw。 |
| HTML injection marker | textContent exact literal；零 innerHTML。 |

## Open Questions

- 无。安全 strings、source union、single-surface ownership、DOM failure terminal 与测试边界均已定义。

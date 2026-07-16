# GH-61 Product Spec：switcher visibility transition 可观察且单次提交

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/61
- `complexity: medium`

## Problem

`App.handleSwitcherToggle` 把 `blocked` 赋值放在 functional state updater 内，却在 `setSwitcherVisibility` 返回后立即读取该局部变量。React 可以延后执行 updater，因此“关闭最后一个可见 provider”虽然保持了 visibility state，却丢失固定 guard toast，用户看到点击无响应且不知道约束原因。

同一 updater 还执行 `saveSwitcherVisibility(next)`。真实入口使用 React `StrictMode`，开发模式会重复求值 updater 以检查纯度，导致一次 accepted toggle 写 storage 两次，并可能重复 storage failure signal。

`origin/main@896a3f7bd24035a614952ba1b0b1dd2caf60d211` 的 disposable real-App reproduction 已确认：`<StrictMode><App /></StrictMode>` 捕获真实 `SettingsView.onSwitcherToggle` 后，only-Claude 的 blocked toggle 保持 state 但不显示 `At least one provider must stay in the switcher`；enable Codex 更新 state 却调用 `saveSwitcherVisibility` 两次。两例 2/2 通过后临时测试已删除，audit worktree 恢复干净。

## Goals

- 从当前已渲染 switcher visibility snapshot 同步决定 blocked 或 accepted terminal，不依赖 updater 何时执行。
- 关闭最后一个可见 provider 时保持所有 visibility 值不变、零 persistence，并精确显示一次固定 guard toast 与一次清理 timer。
- 连续 blocked 用户事件由 latest event 拥有 timer：取消旧 timer、重新获得完整展示时长，并在 unmount 释放 timer ownership。
- 四个 provider 的 accepted enable/disable 均只翻转目标 provider，其他 provider 不变，并在真实 StrictMode contract 下以 exact next snapshot 持久化一次。
- 保持 SettingsView callback、switcher storage schema、active-tab fallback 与 provider refresh wiring 不变。

## Non-Goals

- 不改 tray toggle、tray guard、Settings UI、provider list 或 accessibility layout。
- 不改 storage implementation/schema、failure listener、shadow value 或 error strings。
- 不改 backend、Tauri、provider、polling、notification、cost 或 dependency。
- 不做 broad App decomposition 或 reentrant/programmatic same-render callback API。

## Behavior Invariants

1. `B-001` `SettingsView.onSwitcherToggle` 继续接收真实 `handleSwitcherToggle`，四个 `TrayServiceName` 均使用当前 render 的 `switcherVisibility` 做一次 closed transition decision。
2. `B-002` 当目标当前为 visible 且其他三个均 hidden 时，transition 为 blocked：四个值全部保持、`saveSwitcherVisibility` 零次、fixed guard toast 精确出现一次。
3. `B-003` blocked toast 文本固定为 `At least one provider must stay in the switcher`，使用 `TRAY_GUARD_TOAST_MS`；latest blocked event 取消前一个 owned timer 并重新安排一次 clear，获得完整展示时长；timer 只清除仍为该 guard 的 toast，unmount 取消 pending timer 且零 post-unmount state write。
4. `B-004` 四个 service 各自的 accepted hidden→visible 与 visible-with-peer→hidden transition 只翻转目标 service，提交 exact next snapshot，并调用 `saveSwitcherVisibility(next)` exactly once；共 8 个 terminal，StrictMode 不增加 persistence 次数。
5. `B-005` state updater 保持纯净：persistence、toast 与 timer side effect 不得从 functional updater、state initializer 或 render evaluation 触发。
6. `B-006` active provider 隐藏后回退 Overview、其他 App state/effects、SettingsView props 与 switcher storage failure notification 继续使用既有契约。
7. `B-007` deterministic real-App matrix、executable diff coverage、full frontend/build/Rust 与 current-head PR gates 全部通过，implementation 无 allowlist 外 scope。

## Acceptance Criteria

- 测试挂载真实 `<StrictMode><App /></StrictMode>`，从真实 `SettingsView` instance 捕获 `onSwitcherToggle`；不得测试复制 helper 或跳过 App state。
- 参数化四个 service 的 only-visible blocked terminal：callback 不抛、visibility snapshot 完全不变、persistence 零次、fixed toast 一次。
- fake timers 直接证明首个 blocked terminal 安排一个 `TRAY_GUARD_TOAST_MS` clear；第二个正常用户 blocked event 在旧 timer 到期前发生时取消旧 timer、重新安排一个完整 delay，旧 expiry 后 toast 仍存在、新 expiry 后才清除；不依赖 wall-clock sleep。
- timer callback 只清除仍为 switcher guard 的 toast；unmount 取消 pending owned timer，之后 advance timers 不产生 state write。
- 参数化四个 service 各自的 accepted hidden→visible 与“至少另一个可见”的 visible→hidden terminal，共 8 例：只有目标 bit 变化，`saveSwitcherVisibility` 对 exact next object 精确一次。
- accepted matrix 在 StrictMode 下运行；当前重复 updater-side-effect 实现必须因 persistence count 2 而失败。
- blocked 与 accepted callback 均来自最新 committed render；tests 不建立同一 render callback 的 programmatic reentrant API。
- active provider hidden 后的既有 Overview fallback 至少有一例回归断言；storage/backend/provider contract 不变。
- implementation 仅含 tech spec allowlist；executable TS/TSX diff line coverage ≥80%，`src/App.tsx` measurable changed lines critical 100%。

## Boundary Checklist

| Boundary | Expected result |
| --- | --- |
| only Claude visible → disable Claude | state unchanged；zero save；guard toast once；one clear timer。 |
| each other service only-visible | 与 Claude 相同 blocked terminal。 |
| each hidden service → enable | 四例 target true；others unchanged；exact next snapshot saved once。 |
| each visible service with another visible → disable | 四例 target false；others unchanged；exact next snapshot saved once。 |
| StrictMode updater purity probe | accepted event 仍仅一次 save，无 render/updater side effect。 |
| guard toast before/at expiry | expiry 前存在，`TRAY_GUARD_TOAST_MS` 到期后清除。 |
| two blocked user events | old timer canceled；latest event owns full delay；old expiry 不清 latest toast。 |
| unmount with owned timer | timer canceled；advance 后零 state write。 |
| active provider becomes hidden | existing effect falls back to Overview。 |

## Open Questions

- 无。transition snapshot、fixed toast、persistence cardinality、StrictMode boundary 与测试范围均已定义。

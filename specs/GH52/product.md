# GH-52 Product Spec：刷新结果只能由最新请求提交

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/52
- `complexity: high`

## Problem

provider 与 cost refresh 允许 startup、manual、interval 请求重叠，但没有 generation/latest-wins guard。较慢旧请求可在较快新请求之后写回，令 UI、tray usage callbacks、连接状态、quota windows、error 与 loading 回退到旧快照。provider unmount 后在途请求也仍可调用 parent callbacks。

`origin/main@996a4b61378106253ca11a5e562ed6d2e8facdbd` 的 disposable real-React test 已复现 Codex：request B 先提交 20%，随后旧 request A 把 `onUsageChange` 覆盖成 90%。

## Goals

- 所有 provider/cost async read lanes 采用 latest-request-wins。
- stale success、failure、finally 均零状态写、零 parent callback。
- unmount/effect cleanup 使对应在途 generation 失效。
- loading 只由当前 generation 结束，不能被旧请求提前清除。
- 保持现有 payload、refresh cadence、error text 与 UI 行为；仅修正提交顺序。

## Non-Goals

- 不改变 backend API、payload、cache、refresh interval 或 UI wording。
- 不要求对无法取消的 Tauri invoke 使用 AbortController；允许请求完成但禁止 stale commit。
- 不处理 tray-icon backend command 的 write-order/serialization；它是独立候选。
- 不重构 provider UI、App 路由或 cost merge domain logic。
- 不新增 runtime dependency。

## Behavior Invariants

1. `B-001` 每条 async read lane 的 request generation 单调递增；只有 current generation 可以提交 success state/callbacks。
2. `B-002` stale rejection 不得覆盖 current data/error/connection/quota windows，也不得调用 parent callbacks。
3. `B-003` stale finally 不得把 current request 的 loading 改为 false；current terminal path 必须正常结束 loading。
4. `B-004` unmount 或 owning effect cleanup 必须 invalidate 在途 generation；之后 success/failure/finally 全部无副作用。
5. `B-005` Claude、Codex、Cursor、Antigravity 各自共享一个 guard；Codex info/limits/credits 是一个 atomic generation；Cost overview 与 daily 是两个独立 guard。
6. `B-006` startup/manual/interval entry points 复用同一 lane guard；`autoRefreshIntervalMs <= 0` 对 Codex/Cursor/Antigravity/Cost 均暂停 interval。
7. `B-007` deterministic race matrix、coverage、full frontend/build/Rust 与 PR gates 全部通过，无 extra scope。

## Acceptance Criteria

- disposable Codex 顺序变为：B=20% 提交后，A=90% 晚到不再产生 callback；最终仍为 20%。
- Claude/Cursor/Antigravity/Codex 每个 owner 均以 parameterized deferred evidence 覆盖：new success 后 old success、new success 后 old failure、new failure 后 old success、current pending 时 stale finally、unmount 后 completion。
- Codex 对 info/limits/credits 每个 bundle member 分别覆盖 current rejection 与 stale rejection；只有 current rejection 写 failure，旧 bundle 的任何 terminal path 不产生 partial commit。
- Cost overview 与 daily 可并发且互不 invalidate；两条 lane 分别覆盖 old success、old failure、new failure 后 old success 与 cleanup completion，overview 另覆盖 stale finally，且 cross-lane 请求互不失效。
- Antigravity 的 interval `0` 不注册 polling timer，与其他 providers 一致。
- request coordinator public contract 无 `any`，errors 保持 `unknown`，不吞 current failure。
- dev-only React effect renderer 与 lockfile 中 resolved React exact version 匹配；对应 type package 也仅在 devDependencies；production dependencies 不变。
- implementation 仅含 tech spec 13-path allowlist；新增 executable TS/TSX ≥80%，wiring checker 及 request coordinator 与五个 owner 的新增 stale terminal paths 均为 critical 100%。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| New success then old success | old success 零写入。 |
| New success then old failure | old failure 不清 data、不写 error/disconnected。 |
| New failure then old success | current failure 保留，old success 不伪装恢复。 |
| Stale finally | loading 仍代表 current request。 |
| Unmount | parent callbacks/state writes 均不发生。 |
| Multi-call Codex bundle | atomic generation，无 partial state。 |
| Cost lanes | overview/daily 独立 latest-wins。 |
| Polling disabled | interval <=0 不注册。 |

## Open Questions

- 无。latest-wins、lane ownership、cleanup 与测试边界均已定义。

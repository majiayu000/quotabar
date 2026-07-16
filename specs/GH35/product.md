# GH-35 Product Spec：显式处理 localStorage 写入失败

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/35
- `complexity: medium`

## 背景

QuotaBar 当前有 15 次 `localStorage.setItem` 位于 14 个空 `catch` 块中。写入因 quota、权限或存储不可用而失败时，设置控件仍更新内存状态，用户会误以为设置已保存；重启后设置丢失。notification dedupe 记录失败时仍继续发送，还可能造成重复系统通知。

## Goals

- 让全部现有 localStorage 写入使用统一、显式、可测试的成功/失败契约。
- 设置写失败时保留当前会话的可用性，同时明确告知用户该变化没有持久化。
- notification dedupe 无法持久化时 fail closed，不发送无法可靠去重的通知。
- event log 等后台写失败必须以 error 级别暴露，不得继续使用空 `catch`。
- 保持写成功时的现有 storage keys、序列化格式和用户行为。

## Non-Goals

- 不改变 localStorage 读取失败、缺值或无效 JSON 时的默认策略；现有读取路径将在独立审计项中处理。
- 不迁移到 Tauri Store、数据库或其他持久化后端。
- 不将多次 localStorage 写入包装成事务；浏览器 storage 不提供事务语义。
- 不重做 Settings UI，不修改 PR #31 的 cost/pricing 范围，也不顺带处理与 storage 无关的空 `catch`。

## Behavior Invariants

1. `B-001` 写入成功时，全部现有设置键、值格式、notification dedupe 窗口、event log 顺序与用户可见行为保持不变。
2. `B-002` 用户触发的设置写失败时，当前会话可以继续采用用户选择，但必须显示准确提示：变化仅对当前会话生效且未保存；不得无提示地伪装持久化成功。
3. `B-003` notification dedupe 写失败时，`shouldNotify` 必须返回不发送，避免在无法记录去重状态时重复通知。
4. `B-004` event log 写失败时，本会话内的新事件仍可返回和展示，但失败必须通过统一 adapter 以 `console.error` 暴露。
5. `B-005` `src/` 中全部 15 个现有写点必须经过同一个 storage write adapter；除 adapter 外不得直接调用 `localStorage.setItem`，不得存在写入后的空 `catch`。
6. `B-006` 完成证据必须包含 adapter 成功/失败分支、全部 service 写入口的失败测试、notification fail-closed、可见设置失败提示 wiring、静态范围检查、前端测试/build 与 Rust fmt/check/test。

## Acceptance Criteria

- `localStorage.setItem` 只存在于统一 adapter；adapter 对成功返回 `true`，对异常执行 `console.error` 并返回 `false`。
- budget、notification settings、panel sections、switcher visibility、tray cycle、tray style、tray visibility 的保存 API 都返回显式结果，调用方检查失败并显示统一 toast。
- tab、theme、dock、settings open/close 的直接写入迁移到 adapter，任一写失败都会显示同一准确 toast。
- notification dedupe 写失败时不会调用系统通知发送路径。
- event log 写失败仍返回本会话事件，并产生 error 级证据。
- 测试用抛出异常的 storage stub 覆盖全部 service 写入口；storage adapter 的成功/失败关键分支达到 100% line/branch coverage。
- implementation PR 仅修改 tech spec allowlist 中的路径，不混入读取策略或其他优化项。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| Empty / missing input | N/A：沿用现有 keys 和序列化输入。 |
| Error and failure paths | covered: `B-002`~`B-006`，写异常必须显式返回并按调用场景处理。 |
| Authorization / permission | covered: storage 权限异常与 quota 异常使用同一失败契约；不读取或记录敏感值。 |
| Concurrency / race / ordering | 写入保持同步顺序；不声明不存在的事务或回滚。 |
| Retry / repetition / idempotency | 不自动重试；notification dedupe 失败时 fail closed。 |
| Illegal state transitions | 设置可进入“本会话已变更但未保存”状态，必须用可见提示说明。 |
| Compatibility / migration | covered: `B-001`，keys 和格式不变，无数据迁移。 |
| Degradation / fallback | covered: `B-002`~`B-004`，降级行为必须准确、可见或 error 级暴露。 |
| Evidence and audit integrity | covered: `B-006`，禁止用 happy-path 测试代替写失败证据。 |
| Cancellation / interruption / partial completion | covered: `B-005`, `B-006`；任一写点未迁移即未完成。 |

## Open Questions

- 无。读取失败策略与持久化后端迁移均已明确排除。

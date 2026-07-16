# GH-38 Product Spec：显式处理 localStorage 读取与损坏失败

## Linked Issue

- Issue: https://github.com/majiayu000/quotabar/issues/38
- `complexity: medium`

## 背景

GH35 已让 15 个 localStorage 写点使用显式成功/失败契约，但 14 个读取调用仍被 12 个 `catch` 静默降级。读取权限/运行时异常会与正常缺值混为一谈；损坏 JSON 或不符合 schema 的值会被默认值掩盖。实测 `getItem` 抛错而 `setItem` 成功时，`getSavedTab()` 无 error 地返回默认 tab，notification dedupe 还会返回允许发送并覆盖旧记录，可能产生重复系统通知。

## Goals

- 明确区分正常缺值、有效值、读取/解码失败三种状态。
- 正常缺值继续使用现有默认值，不显示错误。
- 用户设置与 event history 无法读取或解码时，以 error 级证据暴露，并显示准确的“保存的数据未能加载、已使用默认值”提示。
- 合并 App 初始 state 构造期间的多次读取失败；App 订阅后只补发一次 pending warning。
- notification dedupe 读取或解码失败时 fail closed：不写替代记录、不发送；storage 恢复后重新尝试。
- 保持有效数据的 keys、格式、默认值以及 GH35 写失败/session shadow 行为。

## Non-Goals

- 不迁移持久化后端，不变更 key 或序列化格式。
- 不恢复损坏值、不做自动数据迁移；损坏记录整项拒绝并使用当前默认/空值。
- 不重做 Settings UI，不拆分 App/CSS 文件，不修改 storage 以外的空 `catch`。
- 不修改已合并 PR #31 的 pricing/cost 语义。

## Behavior Invariants

1. `B-001` key 缺失时，各 getter 的现有默认值/空集合保持不变，不记录 error、不触发读取失败提示。
2. `B-002` 有效持久化值与 GH35 session shadow 继续按现有 key、格式和优先级读取，成功行为不变。
3. `B-003` 用户设置读取访问失败或解码/schema 失败时，整项使用当前默认值，同时产生不含 key/value 的 error 级证据并进入用户可见读取失败 channel；不得静默伪装为正常缺值。
4. `B-004` App 初始 state 构造期间发生的多个 user-visible 读取失败必须合并为一个 pending warning；App 订阅后补发一次，取消订阅后不再通知。
5. `B-005` notification dedupe 读取访问或解码失败时必须返回不发送，不执行 dedupe 写入、不触发设置读取 toast；storage 恢复后的下一次调用可重新读写并允许发送一次。
6. `B-006` event history 读取访问、JSON 或事件 schema 失败时返回空列表，以 error 级暴露并进入同一 user-visible 读取失败 channel；不得静默过滤损坏事件后伪装完整。
7. `B-007` 完成证据必须覆盖 13 个 public read entrypoints 的有效/缺失/访问失败/损坏输入、pending coalescing、dedupe recovery、GH35 write regression、静态范围、diff coverage、前端与 Rust 全量验证。

## Acceptance Criteria

- storage adapter 导出 typed read result：`missing`、`value`、`failure`；旧 raw `readStorageItem` 不保留 alias。
- adapter 优先解码 GH35 failed-write shadow；没有 shadow 才读取 localStorage。有效 shadow 的会话语义保持不变。
- adapter 捕获 storage access 与 decoder 异常，返回 `failure`、输出固定且不含 key/value/raw fragment 的 error 证据，并按显式选项决定是否进入 read-failure channel。
- user-visible failure 在无 subscriber 时只设置一个 pending 位；首个 subscriber 注册时消费并补发一次。已有 subscriber 时每次独立失败通知一次；unsubscribe 后不再调用。
- tab、theme、dock、settings-expanded、budget、notification settings、panel sections、switcher visibility、tray style/cycle/visibility 和 event history 都使用严格 decoder；known fields 类型错误或 JSON/schema 错误整项拒绝。
- notification dedupe 使用 non-notifying read；失败时 `shouldNotify === false`，storage `setItem` 调用次数为零，恢复后可重试。
- 测试明确证明 missing 与 failure 不混淆、startup 多失败只补发一次、failure log 不包含测试 key/value、GH35 的 write shadow/notify/fail-closed 测试继续通过。
- implementation PR 只修改 tech spec allowlist 中的路径，不混入 App/CSS 拆分或其他优化。

## Boundary Checklist

| 边界 | 结论 |
| --- | --- |
| Empty / missing input | covered: `B-001`；null/missing 是正常状态，不报警。 |
| Error and failure paths | covered: `B-003`~`B-007`；访问、JSON、schema 失败均显式。 |
| Authorization / permission | covered: storage 权限异常进入 typed failure；不记录 key/value。 |
| Concurrency / race / ordering | 同步读取；startup pending 使用单 boolean 合并，订阅时消费一次。 |
| Retry / repetition / idempotency | 不自动重试；dedupe 恢复后由下一次调用重试。 |
| Illegal state transitions | failure 不得变成 missing/value；损坏记录不得部分伪装成功。 |
| Compatibility / migration | covered: `B-001`, `B-002`；有效数据无迁移。 |
| Degradation / fallback | 默认/空值允许但必须在真实 failure 时 error + 准确提示。 |
| Evidence and audit integrity | covered: `B-007`；13-entrypoint 矩阵与 fail-closed 静态门禁。 |
| Cancellation / interruption / partial completion | 任一旧 raw reader/service silent catch 残留即未完成。 |

## Open Questions

- 无。损坏记录采用整项拒绝，正常缺值不报警，已明确。

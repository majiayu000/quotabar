# Codex 打满态、本地估值与设置交互分析

- 状态：已拆成可做 spec，尚未实现
- 日期：2026-09-03
- 触发：ChatGPT Plus / Codex Weekly 官方 100%，本机 pace / weekly value 被 freshness 校验隐藏，同时有 1 张 Gifted bonus reset
- 范围：Codex 面板打满态、本地派生数字策略、popover 交互、Settings 信息架构，以及同类菜单栏配额产品对照
- 非目标：不在本文改代码；不建议 QuotaBar 内核销 reset credit

## 可做 spec

按独立 PR 拆成三包。分析本文只做背景，实现以各包 product/tech/tasks 为准。

| 优先级 | Issue | Spec | 交付 |
|---|---|---|---|
| P0+P1 面板 | [#93](https://github.com/majiayu000/quotabar/issues/93) | `specs/GH93/` | 打满首屏、估值软降级、Bonus 跳转、Tip / last updated |
| P0 通知 | [#94](https://github.com/majiayu000/quotabar/issues/94) | `specs/GH94/` | 100% 与「打满且有券」通知；可与 #93 平行 |
| P2 设置 | [#95](https://github.com/majiayu000/quotabar/issues/95) | `specs/GH95/` | 服务预设、Limits/Alerts 拆组、event 导航；叠在 #94 之后 |

Launch at Login、刷新间隔、独立 Settings 窗口不在这三包里。#95 合入后再开 autostart follow-up。

---

## 1. 现场结论（那张截图）

官方链路是活的。顶部 Connected、红条 100%、`Resets in 3d 16h` / `Mon, Sep 7, 10:27 AM`、Bonus `1 available` 都来自 ChatGPT rate-limit / reset-credit API。

两条橙色字不是官方同步失败，是前端把本机派生层丢掉了：

| 文案 | 数据 | 门槛 | 实际含义 |
|---|---|---|---|
| Local pace unavailable: snapshot older than 30 minutes | ccstats 读的本机周快照 | `observedAt` > 30 min | CLI 停更后不再画消耗投影 |
| Weekly value unavailable: stale or invalid observation time | 同一快照估出的 USD / tokens | `observedAt` > 10 min | 估值对象已经返回，渲染时被扔掉 |

额度打满后不再开 Codex CLI，本机 rate-limit 快照冻住；官方仍稳定返回 100%。本地 `usedPct` 和官方差 ≤ 1% 时，后端继续用旧快照做估值，估值继承旧 `observedAt`，前端按 10 分钟门隐藏。这是「有数不画」，不是「无数可画」。

Bonus reset 是 OpenAI 赠送的周窗口重置券。QuotaBar 只读展示，不能核销。要去 ChatGPT / Codex 里用。

---

## 2. 本地数字该不该留下上次结果

### 2.1 用户 job

打满时人要回答的不是「再确认一遍 100%」，而是：

1. 还能不能用 → 官方 100% 已回答
2. 何时恢复 → 倒计时已回答
3. 要不要烧掉 Bonus reset
4. 这一周额度值多少钱

第 3、第 4 个问题在打满那一刻最急，估值卡却被收成英文错误。

### 2.2 当前设计为什么隐藏

0.3.1 / 0.4.0 的原则：本地派生数字宁可空白，也不画出一张会被截图传播的错账。要防的是窗口切周、用量水位漂了、换账号、时钟乱跳。官方额度走「上次 + Stale data」；估值走 fail-closed。Grok 池估值也是同一套 10 分钟门。

这个原则对 **pace（速率）** 是对的，对 **weekly value（水平值）** 用错了对象。10 分钟是实时速率的保质期，不是「已完成周结算金额」的保质期。官方已 100%、窗口还没切时，估值更接近结算，不是预测。

### 2.3 推荐策略：same-window retention，不是缓存永生

硬拒绝（继续隐藏）：无效总额、`usedPct` 对不上、`resetsAt` 对不上、未来时间、解析失败、换账号。

软降级（显示数字 + Last estimate）：其它都过，只是观察时间超过 10 分钟。

不要做：把 10 分钟改成 24 小时继续隐藏；为这次去做磁盘持久化（IPC 已经带回数字）；让 pace 也显示上次耗尽倒计时；在 QuotaBar 里核销 Bonus。

---

## 3. 打满态的交互问题（估值之外）

估值留不留只解决「数在不在」。这张图真正别扭的是：整页还按「正常监控」做交互，人已经进入「额度用完、要做决定」。

### 3.1 信息层级

同一事实说了四遍（托盘 / 顶栏 / 红条 / Tip），唯一出路（1 张 Bonus）压在最下面且不能点。两句橙色技术英文占了 warning 色，看起来像产品坏了。

100% 时应收起诊断、抬高出路：倒计时和 Bonus 成为第一屏。

### 3.2 死胡同

| 控件 | 现在 | 打满时用户预期 |
|---|---|---|
| Refresh | 空转 Loading，官方仍 100%，本地仍旧 | 以为能消掉橙色 |
| Dashboard | 页脚通用「Open dashboard」 | 去用那张 reset |
| Bonus 卡 | 纯展示 | 主按钮 |
| Tip | `Codex Weekly is at 100%.` | 「等到周一，或用 1 张券」 |

只读不等于不能有跳转。Bonus 行应打开 Dashboard（最好落到 reset credits）。不要应用内核销。

### 3.3 其它断点

- 两句橙色应合并为一条人话：同一根因是本机快照停更。
- Connected 绿灯 + `unavailable` 并存，状态点在撒谎。打满时应写 `Weekly exhausted`。
- 通知有 80% / 95% / Bonus 快过期，没有 100%，也没有「打满且有未用券」。紧急的不是券还剩 29 天，是人已经被挡住。
- 40% 和 100% 用同一组件顺序。应有 exhausted 专用层级。

### 3.4 打满态建议布局

1. 状态条：Weekly exhausted · resets Mon 10:27
2. 主行动：1 bonus reset · Open ChatGPT
3. 结算：Last estimate ≈ $xx
4. 折叠：pace 警告、复读 Tip
5. 背景：Timeline / 本地 cost

---

## 4. QuotaBar Settings 现状

设置嵌在同一 popover 里，齿轮切换 `activeView === 'settings'`，并用 `claude-quota-settings-expanded` 记住是否停在设置页。

| 组 | 内容 | 交互 |
|---|---|---|
| 01 Appearance | Theme；tray Percent / Ring / Icon only；Cycle one icon | 即时生效 |
| 02 Providers | 每服务 Panel / Menu 双开关；至少留一个 panel、至少一个 tray | 关光会 toast |
| 03 Panel content | Timeline / Cost / Trend / Tips 显隐 | 只控制块在不在，不控制块怎么说话 |
| 04 Limits & alerts | Claude / Codex / Cursor 月预算；通知 80% / 95% / Bonus expiry | 预算只影响 cost 区 |
| 05 Activity & system | 最近 6 条 event；macOS Hide Dock | event 不可点、不可过滤 |

硬编码、设置里没有的：

- 刷新间隔（官方 60s，429 退到 5min，auth 失败 1h，隐藏窗口 5min）
- Last updated
- Launch at Login
- 100% / exhausted / reset 通知
- 按 provider、按窗口设阈值
- 估值过期策略（显示上次 / 隐藏）
- 语言
- 引导 / 连接向导
- 打开某服务的 usage 页
- 电源 / 电池节省

设置本身的交互问题：

1. **设置在回答「看起来怎样」，不回答「卡住了怎么办」。** 用户从 100% 面板点齿轮，看不到 refresh cadence、看不到 exhausted 告警、也没有「如何用 Bonus」。
2. **通知模型停在「涨上去」。** 只有 used% 跨越 80/95，以及券快过期。竞品已经覆盖 low / critical / exhausted / reset 全生命周期。
3. **Panel content 只能关模块，不能改模块在打满时的行为。** 关掉 Tips 只是少一块复读，不会出现决策句。
4. **Providers 的 Panel vs Menu 对高级用户很好，对第一次进来的人像权限矩阵。** 没有「我只用 Codex」的一键模式。隐藏的 panel 仍后台刷新，hint 写了，但关不掉轮询。
5. **预算和通知塞在同一组。** 预算是 cost 的输入，通知是配额的输出，job 不同。
6. **Recent events 放在设置里。** 更像诊断抽屉。打满 / 断线这类 event 不能点回对应面板。
7. **设置占用整页 popover。** 项目变多之后会变成长表单。竞品把 Providers / General / Usage 拆成独立 Settings 窗口，菜单栏 popover 保持「看数 + 一两个动作」。
8. **存储 key 仍是 `claude-quota-*`。** 不影响交互，但说明设置是从单服务年代长出来的，没有按「多服务控制面」重新信息架构。
9. **没有 Launch at Login。** 菜单栏配额工具的默认承诺就是开机在。
10. **Refresh 不可配置，反馈也不分情境。** 官方已新、只有本地 extras 过期时，Refresh 仍假装能修好。

---

## 5. 同类竞品怎么做

对照的是同一品类：macOS 菜单栏 AI 配额监控。不是系统监视器，也不是 ChatGPT 官网 Usage 页。

### 5.1 CodexBar（steipete / codexbar.app）— 品类标杆

- 独立 Settings 窗口，而不是把表单塞进 popover。
- **Settings → Providers**：每个服务自己的开关、数据源（OAuth / CLI / cookies）、可选 dashboard extras。
- **刷新**：Manual / 1m / 2m / 5m / 15m / 30m / Adaptive / Adaptive (agent-aware)。新装默认 Adaptive。菜单里永远有 Refresh now；手动刷新时菜单保持打开。
- **过期策略**：stale / error **变暗图标，数字留下**，菜单里写状态。营销文案是 `Updated just now`，把新鲜度做成常驻状态，而不是错误条。
- **通知**：opt-in；按 **剩余百分比** 配阈值，默认 remaining 50% / 20%；session 和 weekly 分开。
- **Reset credits 是一等公民**：`1 reset available` / `Next expires in 27d`，和 session / weekly 并列，不是底部品类卡。
- **Usage & Spend** 单独一页，本地 7/30 天成本，不和开关混在一起。
- 另有 Merge Icons、Overview、WidgetKit、CLI、电池节省、开机后的 provider 探测。

对 QuotaBar 的启示：popover 负责看数和做决定；设置负责源、节奏、阈值。打满时 reset credit 要抬到和红条同一层级。新鲜度用 `Updated 4m ago` 表达，不要用 `unavailable`。

它踩过的坑（不要学错）：为了防「假重置」做过严的 reset-credit 确认，导致官方已经切周、券还在时界面钉死旧百分比。QuotaBar 现在的问题是反的——官方对、本地估值藏过头——但同属「校验比用户还自信」。

### 5.2 AIQuota（aiquota.app）

- 引导式连接，服务可只开一个，空位会收起来。
- 菜单栏 + popover + **桌面小组件**，三种尺寸。
- 告警覆盖 **low / critical / exhausted / reset**。打满和恢复都通知，不只是 80/95。
- 把状态说成 clear / close / capped，而不是校验错误。
- 匿名统计默认关，设置里一项即可。

对 QuotaBar 的启示：exhausted 和 reset 是告警的两端。设置里的通知如果没有这两档，打满场景等于静音。小组件不是必须，但「适配只开一个服务」值得学。

### 5.3 ClaudeQuota

- 极简：环 + 点击 breakdown，几乎没有设置面。
- 阈值写在代码常量里（环 75/90，通知 80/95）。
- **永远有 last updated**。过期是时间戳，不是错误。
- 刷新 3 分钟；429 退避。
- Start at Login，无 Dock。
- 菜单里 Sign in，断线时托盘写 `Sign in`。

对 QuotaBar 的启示：单服务可以几乎无设置。QuotaBar 已经是多服务，不能退回「零设置」，但 last updated 和托盘断线文案是低成本高收益。设置项能不开放就不开放——ClaudeQuota 证明大多数人接受产品默认阈值。

### 5.4 AI Quota Bar（techfanseric）

- Settings 先解决 **连接**（API key / CLI login），再解决显示。
- Displayed provider：Automatic / 指定服务。Automatic 按谁更紧、消耗是否不可持续来切。
- Appearance：详细文字 vs 紧凑环；pace 连续百分比 vs 分档。
- 刷新间隔可调。
- 网络全挂时：**留下上次的环**，中心改成禁止符。Hover 看出准确数字、pace、重置、连通。

对 QuotaBar 的启示：失败态保留上次图形，用一个符号表达「现在连不上」。这正是 weekly value 该走的路。Cycle tray 已经接近 Automatic，但设置里没有解释「为什么现在显示 Codex」。

### 5.5 官方产品自己的「设置」

ChatGPT / Codex / Claude / Cursor 的 Usage 页才是核销和账单的地方。竞品共识是 **深链过去，不在菜单栏里做写操作**。QuotaBar 的 Dashboard 按钮属于这条共识，只是没有情境文案，也没有从 Bonus 行直接跳。

### 5.6 对照总表

| 能力 | QuotaBar | CodexBar | AIQuota | ClaudeQuota | AI Quota Bar |
|---|---|---|---|---|---|
| 设置放哪 | popover 整页 | 独立窗口多 pane | 应用内 + 引导 | 几乎无 | 菜单 Settings |
| 刷新节奏 | 写死 60s | 可选 + Adaptive | 产品默认 | 3min | 可调 |
| Last updated | 无 | `Updated just now` | warning states | 常驻一行 | hover |
| 过期数字 | 官方留、估值藏 | 留 + 图标变暗 | 状态词 | 留 | 留环 + 禁止符 |
| 通知 | 80 / 95 / bonus 过期 | remaining 50/20，分窗口 | low / critical / exhausted / reset | 80 / 95 | 用尽前警告 |
| Reset credit | 底部展示，不可点 | 和窗口并列 | 未强调 | 无 | 无 |
| 打满布局 | 与 40% 相同 | 菜单结构不变，credits 仍在主位 | capped 作为状态 | 环变红 | 环 + 禁止符 |
| Launch at Login | 无 | 有（品类标配） | 引导后常驻 | 有 | 未强调 |
| 只用一个服务 | 手动关 Panel/Menu | Providers 开关 | 自动收空位 | 天生单服务 | Automatic / 指定 |
| 预算 | 有月预算 | Usage & Spend 页 | 无 | 无 | 无 |
| 主题 / tray 皮肤 | 强 | 中 | 中 | 环颜色 | 文字 / 环 |
| 小组件 | 无 | 有 | 有 | 无 | 无 |

QuotaBar 现在的差异化在：**多服务总览 + 本地 cost / weekly value + 主题和 tray 皮肤**。短板在：**打满决策路径、新鲜度语言、设置里的节奏与告警生命周期**。不要用「再加 20 个开关」去追 CodexBar 的 provider 广度。

---

## 6. 设置交互该怎么长

原则：popover 里的设置继续保持短；只放改变「看见什么」的开关。改变「何时响 / 多久刷 / 过期怎么办」的，要么给很少的默认、要么以后再拆独立窗口。

### 6.1 现在不必做成开关的

| 主题 | 建议 | 原因 |
|---|---|---|
| 估值过期 | 产品默认改为 same-window 留下 | ClaudeQuota 把阈值写死；用户没有在设 10 分钟 |
| 打满布局 | 产品默认切换层级 | 不需要「exhausted layout」开关 |
| Tip 文案 | 100% 时自动改成等 / 用券 | 关掉 Tips 不是解决方案 |
| Bonus 可点 | 默认跳 Dashboard | 只读边界内的跳转 |
| 两句橙色合并 | 默认合并 | 实现细节不该进设置 |

### 6.2 值得进设置的（按收益）

**P0 — 补通知生命周期，不要先做刷新滑条**

在 Limits & alerts 里把通知改成四档，默认开：

- Approaching（现有 80%）
- Critical（现有 95%）
- Exhausted（100% / 窗口打满）
- Bonus available while exhausted（打满且有未用券）
- Bonus expiring（现有，保留）

这是 AIQuota 已经验证、CodexBar 用剩余百分比覆盖过的缺口。和截图直接对应：人被挡住、手里有券、系统却不说话。

不要一上来做成「每个 provider、每个窗口、自定义 73%」。CodexBar 那种细阈值是他们用户要的；QuotaBar 的设置已经偏外观。先四档开关，阈值继续产品默认。

**P1 — Last updated 常驻，不是设置项**

面板和托盘 hover 写 `Updated 4m ago`。官方新、本地 extras 旧时写成 `Quota current · local extras 47m ago`。ClaudeQuota / CodexBar 都把这当成状态，不是选项。

**P1 — Refresh 的情境反馈，间隔先不开放**

60s 对菜单栏够用。先改按钮语义：官方已新时不要转圈装忙；本地旧时告诉人「需要一次 Codex CLI 会话」。等真有人要省电 / 要手动，再学 CodexBar 做 Manual / 1m / 5m / Adaptive。

**P2 — Launch at Login**

放进 Activity & system，挨着 Hide Dock。菜单栏工具的默认预期。

**P2 — 「我只用这些服务」的简化**

保留现在的 Panel / Menu 矩阵给高级用户，上面加一行预设：All / Codex only / Claude only。AIQuota 的「只连一个就收空位」比双开关好理解。

**P2 — 设置信息架构微调**

- 04 拆开：Notifications / Budgets，或预算挪到和 cost 更近的地方
- Recent events 可点回对应 provider
- 长到超过一屏再考虑独立 Settings 窗口；现在五组还撑得住 popover

### 6.3 明确不要从竞品搬过来的

- 不要独立做成「Source mode / cookies / OAuth picker」大设置。QuotaBar 的信任模型是复用本机已有登录，少一套凭证 UI。
- 不要 Widget / CLI 来补打满态。那是分发面，不是这条 job。
- 不要匿名统计开关来充设置丰富度。
- 不要在设置里暴露 freshness 分钟数。
- 不要学 CodexBar 用 reset-credit 库存去否决官方新百分比。

---

## 7. 决策与优先级

和截图同一条用户路径上的完整顺序：

| 优先级 | 改动 | 用户立刻感到什么 | 是否进设置 |
|---|---|---|---|
| P0 | 打满层级：倒计时 + Bonus 上移，合并橙色 | 首屏能做决定 | 否，默认 |
| P0 | Bonus 可点跳转；有券时主按钮借义 | 死胡同打开 | 否，默认 |
| P0 | 通知补 Exhausted + 打满且有券 | 不用自己点开托盘 | 是，默认开 |
| P1 | 估值 same-window 保留 + Last estimate | 结算还在 | 否，默认 |
| P1 | Tip 在 100% 改成等 / 用券 | 复读变决策 | 否，默认 |
| P1 | Last updated + Refresh 情境反馈 | 不再像坏了 | 否，默认 |
| P2 | Launch at Login；只用某服务预设 | 更像菜单栏工具 | 是 |
| P2 | 设置分组（通知 / 预算拆开） | 好找 | 是，结构 |
| 以后 | 刷新节奏、独立 Settings 窗口、细阈值 | 追 CodexBar 的控制欲 | 是 |
| 不做 | 应用内 reset、估值开关、freshness 滑条 | — | — |

成功标准（回到那张图）：

- 红条 100% 仍在
- 不再出现 `Weekly value unavailable`
- 估值卡还在，带 Last estimate
- Bonus 是可点的主行动
- Tip 不再复读 100%
- 若开启通知，打满且有券会响一次
- 窗口切到下一周后，旧金额必须消失

---

## 8. 记录说明

本文汇总 2026-09-03 对话里的现场诊断、估值策略、打满交互和设置 / 竞品对照。实现以 `specs/GH93`、`specs/GH94`、`specs/GH95` 为准，不要把本文整页当一个 PR。

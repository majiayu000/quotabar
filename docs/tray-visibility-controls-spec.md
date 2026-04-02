# Tray Visibility Controls Spec

## 目标

在双 tray 基线之上，限制 tray 的显示规则：

- 默认显示两个 tray
- 未登录的服务显示占位 tray
- 面板里提供 Claude 和 Codex 两个独立开关，允许单独关闭对应 tray

## 规则

`tray 可见 = 用户开关开启`

其中：

- 如果服务已连接，tray 显示真实用量
- 如果服务未连接，tray 显示占位图标

## 初始化

- 两个 tray 在原生层先创建，但默认隐藏
- 前端启动后根据用户开关决定是否显示

## 非目标

- 不修改主面板的 tab 结构
- 不新增 Overview 页面
- 不更改 tray 图标样式

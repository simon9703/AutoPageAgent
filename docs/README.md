# 工程文档

本目录按“系统边界、运行机制、页面能力、产品功能、诊断规划”组织。当前实现以源码和测试为准；文档描述稳定边界与关键算法，不重复组件级代码。

## 阅读顺序

| 文档 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | 进程、信任边界、数据流、目录职责 |
| [agent-runtime.md](agent-runtime.md) | Observe → Plan → Confirm → Act → Verify、队列、跳转与 reobserve |
| [page-engine.md](page-engine.md) | DOM Snapshot、ref、动态控件、动作、验证、截图和 dismiss |
| [features.md](features.md) | 对话、Tab 绑定、Skills、录制、仓库分析、日志 |
| [security.md](security.md) | 不可突破的安全边界 |
| [diagnostics.md](diagnostics.md) | 性能口径、已知瓶颈、计划中的分阶段指标 |
| [roadmap.md](roadmap.md) | 当前完成度与后续优先级 |

## 外部实现参考

`docs/github/` 保存对其他项目的源码级分析。它们是设计输入，不是本项目当前行为：

- `chromex-analysis.md`：Side Panel、Codex app-server、页面读取与路由。
- `ego-lite-analysis.md`：语义/视觉/CDP、多层等待与 learned tools。
- `page-agent-analysis.md`：页面内 DOM Agent、动作和导航。
- `browser-use-analysis.md`：DOM/AX 序列化、索引和 Set-of-Mark。
- `vimium-analysis.md`：可点击元素发现、字母提示和跨 frame 协调。

外部分析中的任意 JavaScript、坐标或 CDP 能力，都不能绕过本项目的最新 Snapshot ref、确认、动作白名单和验证规则。

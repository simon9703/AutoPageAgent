# 性能与诊断

## 1. 当前性能结论

多步骤页面任务的主要延迟通常不是 DOM click/fill，而是 Provider turn。一次动作的可见执行包含：

- 元素滚动和 top-layer 复核；
- AI 指针反馈；
- 真实动作；
- action-specific settle；
- Snapshot、diff 和 verification。

如果 Provider 每次只返回一步，同页任务会在每个动作之间重复产生完整模型等待。优化的第一目标是提高 `planStepCount`，同时不跨导航或动态目标边界预排 stale ref。

## 2. 已实施的优化

- Background 支持可信 fingerprint 的本地队列和 fresh-ref 重绑。
- Prompt 强制同页稳定目标返回完整步骤，并提供三步示例。
- Prompt 明确在导航、页面替换、动态 popup 和目标尚不存在前停止。
- `{ ok:false,error }` 中的 URL changed、snapshot expired、target unavailable 和 context invalidated 会进入 reobserve。
- reobserve 不累计 verification failure；派发前 stale 不消耗动作步骤。
- fill/focus 等直接动作使用短 settle；click/submit/dismiss 才有 delayed observation。
- Resource Timing 只按需采集。
- 选择类控件可用目标状态、最终 combobox 值或后续控制变为可操作作为验证。
- AI 指针和滚动准备时间保持可见但缩短。

## 3. 计划中的分段指标

下一阶段应为每个 run/turn 记录结构化指标，而不是依靠事件时间戳反推：

| 指标 | 所有者 | 含义 |
| --- | --- | --- |
| `providerMs` | Bridge/Background | agent.run 发出到决策返回 |
| `planStepCount` | Bridge | 归一化后的步骤数 |
| `executeMs` | Content Script | 单步动作方法时间 |
| `settleMs` | Content Script | 首次 settle 与 delayed observation |
| `snapshotMs` | Content Script | Snapshot 构造和 diff |
| `rebindResult` | Background | unique / missing / ambiguous / skipped |
| `continuationReason` | Background | queue_empty / verify_failed / navigation / stale / blocked_readiness |
| `reobserveReason` | Background | URL、context、content、snapshot |
| `runMs` | Background | 确认后到 terminal |

这些数据应存为独立的 bounded run diagnostics，不能塞进模型 Prompt，也不能包含 ref、输入值、截图或完整 Snapshot。

## 4. 性能判断方法

一次任务按以下方式拆分：

```text
runMs
├── providerMs × turns
├── executeMs × actions
├── settleMs × actions
├── snapshotMs × observations
└── bridge / messaging overhead
```

判断顺序：

1. `turns` 是否接近 actions：若是，先检查 Provider 是否退化为单步计划。
2. 是否发生 stale/reobserve：确认它没有计入失败，也没有重试旧 ref。
3. `settleMs` 是否集中在无变化 click：改善验证语义或 readiness 信号。
4. `executeMs` 是否主要来自动画：缩短视觉等待，不删除运行反馈。
5. `snapshotMs` 是否异常：确认未重复采集 Resource Timing 或扫描过多候选。

## 5. 可靠性诊断

错误分类必须保留三类：

| 类别 | 示例 | 处理 |
| --- | --- | --- |
| stale/context | URL changed、snapshot expired、frame removed | reobserve，不计失败 |
| verification | 值未写入、popup 未关闭、无可观察效果 | continuation，累计失败 |
| unsafe/invalid | sensitive、disabled、selector/坐标、无效计划 | fail closed |

不能通过延长统一 sleep 掩盖分类错误。页面 readiness 应优先使用 URL、MutationObserver、ARIA busy/progress、语义内容变化和 quiet window。

# Page Agent 源码与功能分析

> 参考仓库：`../refs/page-agent`
> 本次基线：`b7401a051c0ce1b1ec3f2713590a78585adf9ae1`（2026-07-23）
> 定位：运行在网页中的文本 DOM Agent；扩展模式补充多标签页和 MCP 控制。

## 1. 产品边界

Page Agent 的核心目标不是提供一个完整定制浏览器，而是给现有网页嵌入一个 Agent：

- 单页模式只需加载 JavaScript，不要求扩展、Python 或无头浏览器。
- 页面理解基于简化 DOM，不发送截图，也不依赖多模态模型。
- LLM、Agent loop 和 DOM controller 都可独立使用。
- Chrome 扩展把同一套 PageController 代理到多个标签页。
- MCP Server 再把扩展中的 MultiPageAgent 暴露给 Claude Desktop、Copilot 等外部客户端。

这套结构适合 SaaS Copilot、表单填写和普通管理后台；对 canvas、地图、白板和主要内容不可语义化的编辑器支持有限。

## 2. 仓库与运行架构

| 包 | 主要职责 |
| --- | --- |
| `packages/core` | ReAct loop、prompt、工具注册、历史和生命周期 |
| `packages/page-controller` | DOM 快照、索引映射、点击/输入/选择/滚动 |
| `packages/llms` | OpenAI-compatible LLM 调用、重试和模型差异适配 |
| `packages/page-agent` | 对外 `PageAgent` API 和一行脚本集成 |
| `packages/extension` | Side panel、MultiPageAgent、远程 PageController、标签页控制 |
| `packages/mcp` | MCP stdio server、localhost HTTP/WebSocket hub |
| `packages/ui` | 页内 Agent UI |

单页调用链：

```text
PageAgent.execute(task)
  -> PageAgentCore loop
  -> PageController.getBrowserState()
  -> LLM AgentOutput macro tool
  -> PageController action
  -> 下一步重新读取 DOM
```

扩展调用链：

```text
Side panel / Hub
  -> MultiPageAgent
  -> RemotePageController
  -> service worker 转发 PAGE_CONTROL
  -> 目标标签页 content script
  -> 页面内 PageController
```

MCP 调用链：

```text
MCP client --stdio--> @page-agent/mcp
  --localhost WebSocket--> extension hub tab
  -> MultiPageAgent
```

## 3. Agent loop

`packages/core/src/PageAgentCore.ts` 实现逐步 ReAct：

1. `getBrowserState()` 生成当前页面观察。
2. 拼接系统指令、用户目标、历史事件、步骤预算和浏览器状态。
3. 把所有动作合并为唯一的 `AgentOutput` macro tool。
4. 模型每一步只能选择一个动作。
5. 工具执行结果写入历史，下一步由模型评价上一步并确定目标。
6. `done` 结束任务；默认最多 40 步。

Macro tool 的输入包含：

- `evaluation_previous_goal`
- `memory`
- `next_goal`
- `action`

这种方式能让普通 tool-calling 模型稳定输出“反思 + 单动作”，但会产生较多模型往返。它没有 AutoPageAgent 的“多步计划一次确认、逐步本地执行与重绑定”。

### 历史和事件

Page Agent 将信息分为两条流：

- `history`：持久进入后续模型上下文，包括 step、observation、user takeover。
- `activity`：只服务 UI，包括 thinking、executing、executed、retrying、error。

错误事件主要用于面板展示，不会持续污染模型上下文。`AbortController` 同时传给 LLM、工具和生命周期，`stop()` 会等待当前运行真正收敛。

### 导航和等待

- URL 变化由 `#handleObservations()` 比较 `lastURL` 检测。
- 发现 URL 改变后追加 observation，并固定等待 0.5 秒。
- 扩展点击后额外等待 1 秒，让加载开始。
- `TabsController.waitUntilTabLoaded()` 最多轮询 4 秒，等待 `chrome.tabs.Tab.status` 不再是 `loading`。
- `wait` 工具允许 1–10 秒，并用上次快照耗时抵扣实际 sleep。
- 连续等待累计达到 3 秒后，prompt 会要求模型不要无理由继续等待。

这里主要判断“URL/Tab load 完成”，没有独立区分：

```text
页面已跳转
≠ DOM 已稳定
≠ 任务数据已加载
```

所以异步骨架页仍依赖模型选择 `wait`，没有语义快照稳定或 blocked 后的自动恢复。

## 4. DOM 快照实现

`PageController.getBrowserState()` 每步调用 `updateTree()`：

- `getFlatTree()` 构建扁平 DOM 树。
- `flatTreeToString()` 生成给模型的简化 HTML。
- `getSelectorMap()` 保存数字索引到真实 DOM 节点的映射。
- `getElementTextMap()` 保存索引对应的可读描述。
- 输出 URL、标题、viewport/page 尺寸、上下剩余像素和页数。

快照只在模型侧暴露 `[index]`，真实 `Element` 引用留在页面：

```text
[35]<button aria-label="Submit">Submit</button>
```

关键策略：

- 默认偏向当前 viewport，可配置 viewport expansion 或全页。
- 只允许模型操作当前快照出现的数字索引。
- 支持 interactive blacklist 和 `[data-page-agent-not-interactive]`。
- 更新快照前清理旧 highlights，更新后重建 selector map。
- simplified HTML 保留层级缩进、文本和有限语义属性。
- URL 不变时可标记新出现的可点击元素，帮助模型识别动态下拉项。

Page Agent 的 refs 本质是一次 DOM 索引的数字键；下一次 `updateTree()` 会重建映射，因此旧 index 不应跨观察复用。

## 5. 动作系统

内置工具：

| 工具 | 实现 |
| --- | --- |
| `click_element_by_index` | 定位索引、滚动到视口、命中测试、派发完整 pointer/mouse 序列并调用 `click()` |
| `input_text` | 支持 input、textarea、部分 contenteditable |
| `select_dropdown_option` | 仅原生 `HTMLSelectElement`，按 option 文本选择 |
| `scroll` | 页面或指定滚动容器的纵向滚动 |
| `scroll_horizontally` | 页面或容器横向滚动 |
| `wait` | 有界固定等待 |
| `ask_user` | 有回调时启用 |
| `done` | 输出最终结果 |
| `execute_javascript` | 实验性；默认可关闭，扩展模式禁用 |

点击实现有几个值得复用的细节：

- 先 blur 上一个点击元素。
- 元素和所在 iframe 都滚动到视口。
- 取目标中心点并执行视觉鼠标移动。
- 用 `elementFromPoint()` 查找最深层命中节点。
- 按 pointerover → mouseover → pointerdown → mousedown → focus → pointerup → mouseup → click 顺序派发。

输入实现：

- 原生 input/textarea 使用 prototype value setter，再派发 `input`。
- contenteditable 先尝试 `beforeinput + DOM mutation + input`。
- 验证文本未写入时退回 `execCommand('insertText')`。
- 最后派发 change/blur。

不足：

- 自定义 combobox/listbox 仍需要“点击展开 → 新快照 → 点击 option”，`select` 本身只处理原生 select。
- 不提供统一 dismiss 动作。
- 工具返回“已点击/已填写”主要说明 dispatch 成功，不是严格的业务状态验证。

## 6. 多页面扩展

`MultiPageAgent` 用 `TabsController` 和 `RemotePageController` 扩展核心 loop：

- 初始化时绑定当前窗口和初始标签页。
- 可选跟踪整个窗口的普通标签页。
- 新标签页会加入专属 tab group。
- 支持 `open_new_tab`、`switch_to_tab`、`close_tab`。
- 每步前同步 tab 列表并等待当前 tab 不再 loading。
- RemotePageController 经 service worker 把 DOM 调用转发到目标 content script。
- 受限页面（`chrome://`、extension、file、devtools 等）不允许 content script 操作。
- 扩展模式关闭任意 JavaScript 工具，因为 `AbortSignal` 不能跨执行上下文安全传递。

它能追踪页面打开的新 tab，并自动切到最新跟踪页，但仍是模型逐步操作，不是 background 持有的可恢复队列。

## 7. LLM、指令和扩展能力

- LLM 层支持 OpenAI-compatible API，并处理不同模型的 tool-call 差异。
- 所有动作 schema 合并进 `AgentOutput`，保证每步必选一个合法工具。
- 支持 system instructions、按 URL 返回 page instructions。
- 可实验性读取站点 `/llms.txt` 作为页面说明。
- custom tools 可新增、替换或删除内置工具。
- UI 使用 status/history/activity 驱动任务状态和操作卡片。
- 扩展持久化任务历史，可重新运行和导出。

MCP 暴露三个高层工具：

- `execute_task`
- `get_status`
- `stop_task`

MCP 不直接暴露底层 click/fill；任务仍由扩展里的 MultiPageAgent 执行。

## 8. 截图与视觉能力

Page Agent 核心明确采用 text-based DOM：

- 不捕获页面截图。
- 不向模型发送图像。
- 不提供坐标点击。
- 无法仅凭 canvas 像素理解界面。
- UI 文档中的截图只是产品展示，不是 Agent 观察输入。

因此截图不应作为“Page Agent 已有能力”写入 AutoPageAgent 设计。AutoPageAgent 的自适应截图是来自 Chromex/Ego 类思路的独立增强。

## 9. 验证与安全边界

已有边界：

- 动作必须使用当前快照数字索引。
- DOM live refs 不离开页面。
- 限制最大步骤，并阻止同一动作无变化地重复超过三次。
- captcha、登录缺少凭据和不可完成任务会返回失败。
- JavaScript 工具可禁用，扩展中默认禁用。
- content script 受 Chrome 页面权限约束。
- MCP HTTP/WebSocket 绑定 localhost。

主要差距：

- 点击成功不等于页面结果成功。
- 完成主要依赖模型在下一步自我评价，没有独立 evidence validator。
- 导航稳定依赖 load 状态和固定等待。
- 没有按 action 类型进行 settle/verification。
- 没有敏感字段的统一快照标记与 bridge 侧动作拒绝。

## 10. 对 AutoPageAgent 的参考价值

适合继续参考：

- 页面内保持真实节点映射，模型只看短 ref/index。
- 每次观察重建 DOM 语义和 viewport/page 提示。
- 动态 option 必须在展开后的新观察中获得新 ref。
- 点击前滚动、命中测试和真实事件序列。
- 历史事件与 UI activity 分离。
- PageController 与 Agent/LLM 解耦。

不应直接照搬：

- 每一步都重新调用模型。
- 用固定 sleep 代替语义稳定判断。
- 将 dispatch 成功作为动作结果。
- 在生产浏览器 Agent 中开放任意 JavaScript。
- 依赖模型自行验证任务完成。

## 11. 后续跟踪项

后续同步 Page Agent 源码时，重点追加：

- DOM tree 的 iframe、shadow DOM、top-layer 和新元素标记变化。
- loop detection 是否从 TODO 变为正式实现。
- 自定义下拉、富文本和表格工具的新增。
- 扩展对 SPA 导航和异步数据加载的稳定等待。
- MCP 权限、审批和 hub 协议变化。
- 完成验证是否从模型自评升级为运行时证据。

主要源码入口：

- `packages/core/src/PageAgentCore.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/src/prompts/system_prompt.md`
- `packages/page-controller/src/PageController.ts`
- `packages/page-controller/src/actions.ts`
- `packages/extension/src/agent/MultiPageAgent.ts`
- `packages/extension/src/agent/RemotePageController.ts`
- `packages/extension/src/agent/TabsController.ts`
- `packages/mcp/src/index.js`

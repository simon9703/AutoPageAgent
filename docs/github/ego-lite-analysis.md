# Ego Lite / ego-browser 源码与功能分析

> 参考仓库：`../refs/ego-lite`
> 本次基线：`f260b21761354ca0d2781ce750418305f16f8988`（2026-07-27）
> 定位：为人和外部 AI Agent 共同使用而定制的 Chromium 浏览器，以及基于 CDP 的 `ego-browser` JavaScript runtime。

## 1. 产品边界

Ego Lite 与扩展型 Agent 的根本区别：

- 它本身是浏览器，不是安装在普通 Chrome 上的侧栏扩展。
- Agent 在独立 Task Space 中工作，不争抢用户正在浏览的 tabs。
- Task Space 继承用户本地登录状态、cookies、extensions 和 bookmarks。
- 任意外部 Agent（Codex、Claude Code、Cursor 等）通过 `ego-browser` skill 驱动。
- Agent 输出一段 JavaScript，一次组合多个浏览器步骤，减少逐工具调用往返。
- 内核提供语义 snapshot 和 Task Space/control handoff 能力。

开源仓库主要包含 skill 和 `ego-browser` SDK；完整 Ego Lite 浏览器是独立下载的软件，部分内核实现不在该仓库。

## 2. 执行架构

典型调用：

```text
External coding agent
  -> reads ego-browser SKILL.md
  -> runs `ego-browser nodejs`
  -> Node helper context
  -> Ego native runtime / CDP
  -> selected Task Space and tab
```

Node 脚本中预加载：

- `page`：Playwright-style facade。
- `browser`：tabs。
- `taskSpaces`：隔离空间与控制权。
- `site`：学习型站点工具。
- `fetch`：Node/browser-origin fetch。
- `cdp`：底层 Chrome DevTools Protocol。

它不是内置固定 Agent loop。Observe、act、wait、verify 如何组合，主要由调用它的外部编码 Agent 和 `SKILL.md` 规范决定。

## 3. Task Space

Task Space 是 Ego 最独特的能力：

- 每个任务拥有独立 tabs。
- 默认继承用户浏览器资料和登录态。
- 多个 Agent 可在多个 Space 并行运行。
- Agent 和用户对一个 Space 的控制权互斥。
- 用户可随时从 GUI take over。

核心 API：

| API | 作用 |
| --- | --- |
| `listTaskSpaces` | 列出所有空间 |
| `useOrCreateTaskSpace` | 复用或创建任务空间 |
| `claimTaskSpace` | 将 user-owned/inactive 空间转给 Agent |
| `handOffTaskSpace` | Agent 主动交还给用户 |
| `takeOverTaskSpace` | 用户确认后 Agent 重新接管 |
| `waitForAgentControl` | 只读轮询控制权，不主动抢占 |
| `completeTaskSpace` | 保留给用户查看或关闭空间 |

ownership：

```text
agent
agentDelegatedToUser
user
```

Skill 强制要求：

- 遇到“user is controlling”立即停止，不得重试或绕过。
- 登录、captcha、人工确认时 handoff。
- 只有用户明确回复继续后才能 takeover/claim。
- 任务完成后单独调用 `completeTaskSpace({ keep })`。

这是一套浏览器级 ownership protocol，比扩展只显示 stop 按钮更完整。

## 4. JavaScript runtime 与 facade

`helpers.ts` 把大量底层模块组合成 Playwright 风格：

```js
await page.getByRole('button', { name: 'Submit' }).click()
await page.getByLabel('Amount').fill('100')
await page.waitForResponse(r => r.url().includes('/api/order'))
```

Locator 支持：

- CSS。
- `xpath=...`。
- `@N` / `ref=N` 快照 ref。
- `loc=css:...`、`loc=role:...`、`loc=href:...` 等稳定 locator。
- `getByRole/Text/Label/Placeholder/AltText/Title/TestId`。
- `first/nth/last`、嵌套 locator 和 filter。

Locator 动作和读取：

- click、dblclick、hover、dragTo。
- focus、fill、clear、press、check、selectOption。
- setInputFiles、dispatchEvent。
- text/value/attribute/state/boundingBox。
- count、allInnerTexts、evaluate/evaluateAll。
- locator screenshot 和 waitFor。

解析层要求 strict match；多匹配时需要明确 `first/nth`，避免静默点击错误元素。

## 5. 语义 Snapshot

`driver/observe.ts` 的 `snapshotRaw()` 调用浏览器内核提供的 `ego.snapshot()`：

- 默认 `scope=full_page`。
- 默认带 action marks。
- 默认带 stable locator。
- 返回 `{ content, refs }`。
- refs 被转换到 Node 侧 `RefMap`。

`snapshot()` 只返回适合模型读取的文本；`snapshotRaw()` 保留结构化结果。

快照 ref 的规则：

- `@N` 只允许来自最近一次 snapshot。
- 每次 snapshot 会刷新 ref map。
- ref 数字源自 CDP `backendNodeId`，同一节点可能保持数字稳定。
- 但节点必须出现在最新 snapshot，才能继续用 `@N`。
- 长期步骤应改用 snapshot 提供的 stable `loc=...`。

README 声称内核 snapshot 能处理深层 iframe；开源 SDK 只展示 snapshot 调用和 refs 映射，具体内核遍历算法不在仓库中，分析时不能把实现细节臆测为普通 DOM query。

## 6. 语义、视觉和 CDP 三种工作流

Skill 明确要求先选择工作流。

### 6.1 Semantic

适用普通页面：

1. `snapshotText()` / `page.snapshot()`。
2. 使用最新 `@ref` 或稳定 locator。
3. click/fill/select。
4. 重新 snapshot/pageInfo 验证。

适合表单、按钮、列表、表格和普通内容页。

### 6.2 Visual

适用 canvas、虚拟化编辑器、地图、Figma、Docs、Sheets、Notion、白板：

1. `captureScreenshot()`。
2. 模型读取截图。
3. 用 viewport 坐标 click/dblclick/drag。
4. 用真实 keyboard 输入。
5. 再截图或通过 export/readback 验证。

对富文本大段输入前，Skill 要求先写入一个很小的 probe；如果文字落到标题栏、工具栏搜索或隐藏 input，就停止 DOM 输入并切换视觉路径。

### 6.3 Direct DOM/CDP

- `js()` 基本等价于 `Runtime.evaluate`。
- `cdp()` 可调用任意允许的 CDP method。
- 适合结构化提取、浏览器状态、网络和 helper 未覆盖能力。

Ego 允许组合三者，不强制“视觉只辅助 DOM”。这比 AutoPageAgent 权限更强，也意味着更高风险。

## 7. 截图实现

`driver/observe.ts` 使用 `Page.captureScreenshot`：

- 默认 PNG。
- 默认当前 viewport。
- `fullPage` 使用完整页面尺寸。
- 支持 clip 和 locator screenshot。
- 根据 `devicePixelRatio` 将 CSS 像素换算为截图 scale。
- 原生 dialog 阻塞 page JS 时退回 raw capture。
- 默认写入系统临时目录，并用 pid + sequence 防止并行覆盖。
- 支持 raw 模式和自定义路径。

另有：

- `Page.startScreencast` / stop。
- video recorder 将 screencast frames 编码为视频。
- screenshot 和 screencast 事件不会无限塞入普通事件队列。

## 8. 鼠标、键盘和真实输入

Pointer 基于 CDP `Input.dispatchMouseEvent`：

- 支持 selector/ref、绝对坐标、元素内 offset。
- click、double click、hover、drag、wheel、down/up。
- 默认取元素中心点。
- 可用 action label 显示视觉 highlight。
- mousePressed/mouseReleased 之间加入极短延迟。

输入后会安装页面 probe 观察 trusted event；当 CDP dispatch 超时但页面已收到事件时，可避免误报失败。

Keyboard 层支持：

- press、down/up、insertText、type。
- fill 和逐字符输入。
- checkbox/radio。
- selectOption。
- file input。
- 对 selector/ref 使用统一 element resolver。

这种真实 CDP 输入比 `element.click()` 更接近用户行为，特别适合 canvas 和复杂编辑器。

## 9. 导航、页面加载与等待

导航能力：

- list/current/switch/open/reuse/close tab。
- `goto` / `gotoAndWait`。
- reload。
- `ensureRealTab()` 避开浏览器内部页。
- `iframeTarget()` 获取高级 CDP iframe target。

等待能力：

| API | 判断 |
| --- | --- |
| `waitForURL` | exact、glob、RegExp 或同步 predicate |
| `waitForLoadState('load')` | `document.readyState=complete` / Page lifecycle |
| `domcontentloaded` | DOM interactive/lifecycle |
| `networkidle` | CDP Network 请求计数进入 idle window |
| `waitForSelector` | attached 或 visible |
| `waitForFunction` | 页面表达式轮询 |
| `waitForRequest` | URL/RegExp/predicate 匹配 request |
| `waitForResponse` | 匹配 response，可读取 body/text/json |
| `waitForEvent('download')` | 下载开始和完成事件 |

这让调用方能显式表达“点击哪个功能后等待哪个接口”：

```js
const responsePromise = page.waitForResponse(
  r => r.url().includes('/api/order') && r.status() === 200
)
await page.getByRole('button', { name: 'Submit' }).click()
const response = await responsePromise
```

但它不会自动知道哪一个 API 代表业务完成。匹配规则必须由 Agent、站点知识或用户任务提供。`networkidle` 也只表示暂时没有网络请求，不能证明页面语义或任务数据已经可用。

## 10. 网络、下载、文件与 fetch

CDP Network domain 支持：

- request method、headers、postData 和 resourceType。
- response status、headers、request 关联。
- `Network.getResponseBody()` 获取 body。
- redirect response。
- 多个 network waiter 共享 domain enable，并在最后一个释放后 disable。

文件能力：

- `setInputFiles` / `uploadFile`。
- download 行为设置到临时目录。
- 等待 `downloadWillBegin` 和 `downloadProgress`。
- 返回 `path()` 和 `saveAs()`。

Fetch：

- `serverFetch`：Node 网络环境。
- `browserFetch`：当前页面 origin/session 环境。

这些是自动化 SDK 能力，不适合直接全部暴露给 AutoPageAgent 的模型动作层。

## 11. Dialog、iframe 和异常边界

- 页面原生 dialog 打开时，page JS 可能被阻塞。
- `pageInfo()` 返回 `{ dialog }`，调用方用 `Page.handleJavaScriptDialog` 接受或拒绝。
- iframe 可通过 snapshot 内核语义处理，也能用 `iframeTarget()` 取得 session。
- object handle 在调用后释放。
- session/context 销毁时 release 是 best effort。
- browser runtime 维护有界 CDP event buffer。
- Ego 自有错误会转换为 agent-friendly guidance。
- user-control/inactive space 属于 hard stop，不作为普通 CDP 错误重试。

## 12. Learned site tools

学习目录可包含：

- notes/knowledge。
- Node tools。
- browser-side tools。
- manifest 中的 args/returns/schema。
- URL/domain 匹配和示例。

运行入口：

- `site.skills(url)`
- `site.learnContext(url)`
- `site.runTool()`
- `site.runBrowserTool()`

校验会拒绝：

- 不安全 tool name/path。
- 缺失 callable。
- 非法 manifest。
- 工具源码中的临时 snapshot ref。

临时 ref 不能固化进 site skill，必须改成 stable locator。这一点非常适合 AutoPageAgent 的 Recorded Skill。

## 13. 验证模型

Ego SDK 没有一个统一的 `ActionVerification` 类型。验证由脚本组合：

- locator state：value、checked、visible、enabled、attribute。
- fresh snapshot。
- screenshot。
- page URL/title/info。
- waitForResponse/request。
- export/download/readback。
- direct JS state。

优点是灵活，能覆盖复杂业务；缺点是每个外部 Agent 都可能写出不同质量的验证逻辑。Skill 通过 workflow 规范要求“有意义操作后重新观察”，但不是 runtime 强制。

## 14. 安全与风险

安全优势：

- 用户与 Agent Task Space 隔离。
- 明确 ownership 和 handoff。
- user takeover 是 hard stop。
- Task Space 可在完成后关闭。
- 数据保持本地。
- temporary refs 不允许写进 learned tools。

高权限风险：

- 可运行任意页面 JavaScript。
- 可调用原始 CDP。
- 可坐标点击和键盘输入。
- 可读网络请求/响应 body。
- 可上传文件和下载。
- 继承真实登录态。

因此 AutoPageAgent 只能选择性借鉴其等待、观察和控制权设计，不能把完整 Ego helper surface 直接交给模型。

## 15. 对 AutoPageAgent 的参考价值

适合继续参考：

- semantic first，canvas/rich editor 才 visual first。
- fresh snapshot ref 与 stable locator 的明确区别。
- screenshot 的 CSS/DPR 坐标换算。
- `waitForURL/load/networkidle/selector/response` 的可组合概念。
- 点击后用语义状态、接口、截图或 readback 验证。
- Task Space ownership/handoff 的 hard-stop 思想。
- learned site tools 禁止持久化临时 refs。
- CDP 真实 pointer/keyboard 事件细节。

暂不应引入：

- 任意 `js()` / `cdp()`。
- 普通场景的模型坐标点击。
- 让模型自行编写不受限多步骤脚本。
- 默认读取 request/response body。
- 为解决少数富编辑器场景而放宽整个动作安全边界。

## 16. 页面与接口加载的通用结论

Ego 提供很多 signal，但没有单一“页面完成”真值：

```text
URL matched
  -> 导航目标已提交/到达

load/domcontentloaded
  -> 文档生命周期达到阶段

networkidle
  -> 网络暂时安静

response matched
  -> 某个已知业务请求返回

selector/function matched
  -> 任务需要的页面状态已出现

fresh snapshot/screenshot
  -> Agent 获得新的可决策证据
```

解决 90% 场景的组合仍应是：

1. 导航只使旧 refs 失效。
2. 等待 DOM/语义快照 quiet。
3. 检查 busy/loading。
4. 已知任务目标时等待目标 selector/语义。
5. 已知关键请求时可选等待 response。
6. 无变化且 blocked 时再进行一次截图恢复。
7. 最终成功必须匹配任务证据，而不是仅凭 network idle。

## 17. 后续跟踪项

后续同步 Ego Lite 时重点追加：

- 内核 snapshot API 和 iframe/ref schema 是否公开更多细节。
- Task Space ownership protocol 变化。
- screenshot/screencast 和视觉 workflow。
- waitForNetworkIdle、request/response body 和事件 buffer。
- locator strictness、stable locator 和 ref refresh。
- learned site tools 的格式与经验积累功能。
- Windows/Linux 支持和浏览器内核开放范围。

主要源码入口：

- `skills/ego-browser/SKILL.md`
- `package/ego-browser/src/helpers.ts`
- `package/ego-browser/src/driver/observe.ts`
- `package/ego-browser/src/driver/waits.ts`
- `package/ego-browser/src/driver/pointer.ts`
- `package/ego-browser/src/driver/keyboard.ts`
- `package/ego-browser/src/driver/locator.ts`
- `package/ego-browser/src/element-resolver.ts`
- `package/ego-browser/src/browser-runtime.ts`
- `package/ego-browser/src/learning/`

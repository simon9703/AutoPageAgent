# Chromex 源码与功能分析

> 参考仓库：`../refs/chromex`
> 本次基线：`dda4409583d9ea7ef4bba8df515a6259be3a9b9b`（2026-06-15，v0.1.8）
> 定位：Chrome MV3 侧栏助手，通过 Native Messaging 和本地 bridge 接入 Codex app-server。

## 1. 产品边界

Chromex 不只是网页操作 Agent，而是一个完整浏览器侧栏助手：

- 当前页、选中文本、多个标签页、浏览历史和站点 adapter。
- 图片、截图、PDF、Office、文本和表格附件。
- Codex OAuth 登录、模型/skills/apps/plugins/MCP 枚举。
- 语音输入、实时翻译、Live transcript。
- 图片生成和非破坏式图片编辑。
- 当前标签页 DOM 操作，以及独立 Playwright 新标签页工作流。
- 会话、profile、plan mode、action card 和权限按需申请。

它的强项是“上下文路由和产品能力完整”，不是严格的长链路 observe-act-verify 浏览器 runtime。

## 2. 进程与包边界

| 包 | 主要职责 |
| --- | --- |
| `packages/extension` | Side panel、background、content script、页面采集、权限与 UI |
| `packages/native-host` | Chrome Native Messaging relay |
| `packages/bridge` | Codex app-server、路由、附件、图片、Playwright、secrets |
| `packages/shared` | read strategy、context envelope、profiles、action types |

核心链路：

```text
Chrome extension
  -> chrome.runtime.connectNative
  -> Native Messaging Host
  -> local bridge RPC router
  -> Codex app-server JSON-RPC
```

Native host 是 Chrome 可启动的本地入口；bridge 再启动或连接 `codex app-server`。扩展不持有 API key、OAuth token 或 ChatGPT session。

## 3. Codex app-server 集成

`packages/bridge/src/codex-app-server.ts` 负责：

- 发现和启动 Codex executable。
- 通过 stdin/stdout 传输 JSON-RPC。
- `initialize` / `initialized`。
- request id、pending promise、超时和进程退出处理。
- notification 和 server request 分发。

`codex-plane.ts` 在此基础上实现：

- `account/read` 登录状态和 ChatGPT plan 判断。
- thread 创建、恢复、归档和 transcript。
- `turn/start`、`turn/interrupt`、delta 与 item 事件。
- model、rate limit、skills、apps、plugins、MCP 映射。
- plan item、reasoning、agent message、context compaction 等事件。
- goal 自动继续、turn steer、重连和指数退避。
- 图片生成/编辑、临时文件和结果资产。

主聊天拒绝 API-key Codex session，要求 ChatGPT/Codex OAuth；Realtime translation 的 API key 是独立能力。

## 4. Agentic routing

Chromex 在真正请求主模型前有路由阶段。路由结果区分：

- 用户 intent：总结、问答、生成、编辑、导航、浏览器操作等。
- context source：current page、selection、image、file、open tabs、history。
- read strategy：DOM、vision、hybrid、adapter。
- browser control：是否控制、active-tab/new-tab、DOM/Playwright/computer-use 能力。
- preconditions：外部研究、内容生成、上下文收集、用户确认。
- structured inputs：Codex skill、app、plugin、MCP mention。

这使“理解请求需要什么上下文”和“执行当前页面动作”分开，避免所有消息都读取全部页面或都启动浏览器控制。

Chromex 还支持 deferred browser action：上游 Codex 先生成内容，随后用独立 DOM planner 把生成结果填入当前页面。

## 5. 页面读取策略

`packages/shared/src/read-strategy.ts` 的自动策略很小：

```text
adapterMatched                     -> adapter
hasCanvas                          -> hybrid
hasVideo / dense interactive UI   -> hybrid
textLength < 500 && imageCount > 0 -> vision
otherwise                          -> dom
```

四种策略：

| 策略 | 上下文 |
| --- | --- |
| `dom` | 页面文本、选择文本、图片元数据、站点信息，不附截图 |
| `vision` | 可见页截图为主要视觉证据 |
| `hybrid` | DOM 摘要 + 可见页截图 |
| `adapter` | YouTube、PDF、arXiv、Google Workspace 等结构化私有 payload |

`collectCurrentPageContext()` 流程：

1. content script 执行 `page.collect`。
2. 读取 features：文本长度、图片数、canvas、video、dense UI。
3. 自动或显式选择策略。
4. 仅 vision/hybrid 调用 `captureVisibleTab()`。
5. `normalizePageContext()` 生成统一 `PageContextEnvelope`。
6. 根据策略和 adapter 生成 action cards。

DOM 采集失败时会降级：

```text
DOM probe error
  -> PDF/site/minimal fallback context
  -> 尝试可见页截图
  -> vision
```

如果自动选择了视觉策略但截图权限不可用，会回退 DOM；如果用户明确要求 vision/hybrid，则保留错误。

## 6. Context envelope 和预算

统一页面上下文包括：

- metadata：URL、标题、domain。
- selectionText。
- domSummary。
- visionAssets。
- adapterPayload。
- privacyFlags。

图像二进制不嵌进文本 prompt。Prompt 只描述“附加了几个视觉证据”，随后 `createCodexTurnInputItems()` 添加：

- `image`：HTTP(S) URL。
- `localImage`：本地文件。
- data URL：先 materialize 为临时本地图像。

同一输入还可加入：

- `skill`
- `mention`（app/plugin/MCP）
- uploaded files
- workspace instructions

DOM 文本通过 shared context budget 压缩，conversation context 也有尾部长度限制。

## 7. 站点 adapter

Chromex 当前包含：

- YouTube：标题、频道、当前播放时间、视频相关动作。
- PDF：识别浏览器 PDF 页面和实际 source URL。
- arXiv：论文 id、标题和 PDF 关联。
- Google Workspace：结构化页面信息。

Adapter 优先级高于 DOM/vision，因为它提供比屏幕和通用文本更稳定的业务语义。Action card 可以根据 adapter actions 生成“总结视频、总结当前时刻、生成博客”等站点建议。

这是 AutoPageAgent 后续 Page Skill 的可参考方向：adapter 只补充结构化上下文和建议，不绕过统一动作/权限边界。

## 8. 当前标签页 DOM 操作

Chromex 的 active-tab 操作是独立工作流：

1. 路由决定 `browserControl.surface=active-tab`、`mode=dom`。
2. 权限 gate 检查 `page.dom.perform`。
3. content script 生成 `BrowserDomSnapshot`。
4. bridge 启动临时 Codex thread 生成最多 4 步计划。
5. bridge 校验 action、ref、selector、URL 和长度。
6. content script 顺序执行步骤。
7. side panel 汇总每步结果。

快照最多 80 个元素，候选包括：

- button、link、input、textarea、select。
- 常见 ARIA role。
- `aria-haspopup/controls/expanded`。
- contenteditable、Lexical、Slate、ProseMirror、Quill。
- tabindex 和 editor placeholder。

每个元素包含 ref、role、tag、label、text、selector、value、href、ARIA、viewport rect，以及：

- `isTextEntryCandidate`
- `opensEditableSurface`

DOM planner 只接受快照里的 ref 或原样 selector；navigate 只允许 HTTP(S) 和用户明确/页面可见 URL；禁止 JavaScript、XPath 和隐藏元素 selector。

### 编辑器处理

当页面只显示“写回复/发消息”入口、真实 editor 尚未创建时：

- planner 先 click/focus opener。
- fill 允许暂时仍指向 opener。
- runtime 激活 opener 后，最多短时轮询新出现/获得焦点/附近的 editable target。
- 找到后再用 native setter 或 contenteditable 输入。

这解决一部分动态 editor，但没有为每一步重新调用 planner，也没有 fresh snapshot/ref 重绑定。

## 9. 动作执行与验证

动作类型：

- click
- fill
- select
- scroll
- focus
- submit
- navigate

执行层会检查元素可见/启用，并显示 in-page control indicator。用户可 stop。

局限：

- 点击主要调用 `element.click()`。
- 步骤结果主要表示执行是否抛错，不验证预期 DOM 状态。
- 多步计划使用同一快照映射，页面分支后旧 ref 可能失效。
- navigate 调用 `location.assign()` 后即返回成功。
- 没有 AutoPageAgent 的逐动作 snapshot diff、fingerprint 重绑定和完成证据校验。
- 安全策略明确拒绝购买、支付、结账和转账；与 AutoPageAgent 的“用户授权测试环境”策略不同。

因此 Chromex 的 DOM action plane 更接近“受限的一次性计划执行器”，不是完整可恢复 Agent loop。

## 10. 独立浏览器与 Playwright

路由可以选择：

- `active-tab + dom`：修改用户当前页。
- `new-tab + playwright`：独立自动化或测试任务。

Bridge 的 Playwright runtime 管理独立浏览器控制，适合与当前页无关的测试/研究流程。路由会优先使用已连接 app/plugin/MCP 获取服务数据，不会为了 Gmail、Calendar、GitHub 等资源盲目打开网页。

Computer-use/视觉坐标能力由 runtime capability 控制；不能假设所有安装都提供。当前 active-tab 主路径仍是 DOM plan，不直接把截图坐标交给 content script 执行。

## 11. 截图与视觉

Chromex 的截图原则：

- DOM 页面默认不截图。
- canvas、video、dense UI 使用 hybrid。
- 少文本大图页面使用 vision。
- DOM 采集失败时尝试截图 fallback。
- 用户显式选择 screenshot/image 时直接附加。
- infographic 等视觉任务可从 DOM fallback 到 hybrid 或 visible-screen-only。
- capture 有节流与 Chrome 权限处理。

截图改善模型理解，但 active-tab DOM 操作仍依赖 ref/selector。这正是 AutoPageAgent 当前“自适应视觉恢复、动作仍 DOM constrained”的主要参考。

## 12. UI 和完整产品能力

Side panel 还实现：

- 多会话、搜索、历史持久化选项。
- 流式 delta buffer 和消息 trace。
- 模型、reasoning effort、service tier 设置。
- profile 和 `/` 选择器。
- open tabs `@` mentions。
- 文件拖放、图片预览和生成资产。
- Markdown、代码块、表格、复制和重新生成。
- voice dictation、barge-in、实时字幕和翻译。
- context compaction 通知。
- plan/user-input card。
- 站点权限、history、tabs、screen capture、microphone 按需申请。
- 诊断日志和可读错误映射。

这些属于产品层能力，不应全部塞进 AutoPageAgent 的基础浏览器 loop。

## 13. 安全与隐私

- secrets 留在 bridge 内存或本地安全边界。
- extension storage 不保存 raw API key/token。
- Native host 子进程使用缩减环境变量 allowlist。
- 页面、历史、截图、麦克风和操作只在对应请求中收集。
- 浏览器权限按能力申请。
- 当前页 mutation 经过 operation confirmation gate。
- 路由和 planner 都会做 schema/能力限制。
- 临时图像与上传文件由 bridge 管理。

AutoPageAgent 可继续借鉴其“按路由收集上下文”和“图像作为独立 turn input”，但仍应保留更严格的动作验证。

## 14. 对 AutoPageAgent 的参考价值

适合继续参考：

- `dom | vision | hybrid | adapter` 的轻量策略。
- DOM 失败后的可见页 screenshot fallback。
- 图片二进制与文本 prompt 分离。
- Local Codex 的 `image/localImage/skill/mention` turn input。
- route planning、context collection、action planning 三层分离。
- adapter 优先提供结构化业务上下文。
- active-tab 与独立 Playwright surface 分开。
- 权限按需、secrets 不进入 extension。

不应直接照搬：

- 同一快照连续执行多步且不重绑定。
- 把 DOM method 无异常当作动作成功。
- navigate dispatch 后立即报告成功。
- 用完整产品路由复杂度解决基础 DOM loop 问题。
- 让 selector 成为与 ref 同等的长期动作凭据。

## 15. 后续跟踪项

后续同步 Chromex 时重点追加：

- active-tab action plane 是否增加 observe/verify/replan。
- computer-use 是否正式接入 active-tab。
- read strategy 阈值和 screenshot 降级策略变化。
- adapter、新 apps/plugins/MCP 和 structured input。
- Codex app-server 新事件、server requests 和认证变化。
- 图片生成/编辑、语音和 compaction 生命周期。
- permission plan、敏感表单和持久化策略。

主要源码入口：

- `packages/shared/src/read-strategy.ts`
- `packages/shared/src/context.ts`
- `packages/shared/src/types.ts`
- `packages/extension/src/page-context.ts`
- `packages/extension/src/background/index.ts`
- `packages/extension/src/content/index.ts`
- `packages/bridge/src/agentic-router.ts`
- `packages/bridge/src/browser-actions.ts`
- `packages/bridge/src/codex-app-server.ts`
- `packages/bridge/src/codex-plane.ts`
- `packages/bridge/src/prompt.ts`

# 功能模块

## 1. 对话与 Tab 隔离

每个浏览器窗口只有一个当前对话：

- 空对话跟随当前活动 HTTP(S) Tab；
- 首条用户消息锁定 `targetTabId`；
- 后续切换 Tab 不改变任务目标；
- 目标页内部导航仍属于原对话；
- 目标 Tab 关闭后停止运行并要求 New；
- 恢复历史只在原 Tab 仍存在时恢复绑定；
- UI 事件必须同时匹配 window、conversation 和 target Tab。

`needs_user` 会持久化原始任务。用户输入或确认推荐选项后继续原任务，而不是创建新任务。

## 2. Provider

支持两条路径：

- Local Codex：Native Host 启动 `codex app-server`，使用 ChatGPT/Codex 登录状态；
- Responses API：Bridge 从进程环境读取 API key，Extension 不接触密钥。

两者共用相同 Prompt、AgentDecision、动作白名单和 Bridge 归一化规则。

`AgentDecision` 还包含不执行页面动作的 `observe`：用于等待 busy/progress 或动态列表形成稳定语义变化，单次最多 30 秒且计入全局时间预算。

## 3. Skills

Skills 是声明式工作流上下文，不是新的执行器：

- Marketplace 模板存放在仓库 `skills/`；
- 用户 Skills 存放在 `~/.auto-page-agent/skills`；
- 支持安装、启用/禁用、更新、删除、导入、导出；
- 支持从当前页面对话和操作生成可编辑草稿；
- 支持录制动作生成 `SKILL.md + workflow.json`；
- 更新自建 Skill 必须显式选择 update 并递增 patch 版本；
- 页面 URL 只影响推荐顺序，不阻止用户明确选择的 Skill 跨路由、域名或环境继续运行。

Skill 执行仍经过相同的确认、最新 ref、预算、验证和敏感字段规则。

## 4. 录制与回放

录制覆盖：

- click；
- 普通表单输入（敏感值不记录）；
- checkbox/radio 等可检查控件；
- 页面或容器滚动；
- 页面导航；
- bounded key-frame screenshots。

截图只用于当前录制会话的编辑上下文，不写入 Skill 文件、导出包或对话日志。回放使用声明式动作并经过确认，不保存旧页面 ref。

## 5. 元素与截图上下文

用户可选择任意元素或元素截图并附加到下一条消息：

- 保留 tag、role、label、附近文本和页面 URL；
- 图片通过 `captureVisibleTab` 后按元素可见 rect 裁剪；
- 发送成功后从 composer 消费；
- 用户消息只保存文字摘要；
- 后续 continuation 不重复发送摘要或二进制。

## 6. 本地仓库分析

选中元素后可将页面证据与本地仓库关联：

- 根据 label、text、属性、source hint 和 API pathname 生成候选；
- 使用直接参数数组调用 `rg`；
- 固定字符串匹配，限制根目录、结果数、文件大小和超时；
- 输出 source、symbol、text、API 等证据和置信度。

当前只证明“可能相关”，尚不能稳定证明 DOM → Component → Hook → API 的完整调用链。

## 7. 性能与 API 证据

Resource Timing 是显式能力：

- 用户询问性能/网络/API 时随初始 Snapshot 采集；
- 仓库分析通过独立 `page.performance` 请求采集；
- 普通动作循环不采集；
- URL 去除 query 后作为仓库证据；
- 不包含请求体、响应体、method 或 status。

## 8. 历史日志

日志保存在 `~/.auto-page-agent/logs`，包括：

- 压缩后的用户/助手消息；
- 目标页元数据；
- pending choice；
- Action、Verify、Complete、Error；
- monotonic revision，防止旧异步写覆盖新状态。

不保存截图 data URL、表单值、Snapshot、ref 或 Provider JSON 片段。

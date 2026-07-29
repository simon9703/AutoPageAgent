# 产品状态与 Roadmap

当前版本：0.12.x。

## 已完成

### Runtime 与页面执行

- [x] Observe → multi-step Plan → confirm once → Act → Verify
- [x] 本地步骤队列、可信 fingerprint 和 fresh-ref 重绑
- [x] URL/SPA/context/stale reobserve
- [x] 同时分类 thrown error 与 `{ ok:false,error }`
- [x] 动态 combobox、option 最终值与多选 dismiss
- [x] action-specific settle 和 bounded delayed observation
- [x] 精确 completion evidence 与一次恢复 turn
- [x] bounded DOM Snapshot 和按需视觉恢复
- [x] 截图 Set-of-Mark 与 ref 映射

### Side Panel 与对话

- [x] window + conversation + target Tab 隔离
- [x] New、Stop、History、Reconnect
- [x] 初始计划确认卡与真实运行时间线
- [x] needs_user 推荐选项确认与原任务续接
- [x] 一次性元素/截图上下文

### Skills 与工具

- [x] 本地 Registry 与 Marketplace
- [x] 明确选择的 Skill 跨页面/域名/环境继续运行
- [x] 安装、更新、启停、删除、导入和导出
- [x] 表单、检查控件、滚动、导航和关键帧录制
- [x] 从当前对话和操作生成 Skill 草稿
- [x] bounded 本地仓库 `rg` 证据检索
- [x] 按需 Navigation/Resource Timing

## P0：运行可靠性与诊断

- [ ] 持久化 `providerMs/executeMs/settleMs/snapshotMs/runMs`
- [ ] 记录 `planStepCount/rebindResult/continuationReason`
- [ ] Skill debug 展示失败步骤与验证证据
- [ ] 浏览器集成测试：导航、Tab 关闭、Stop、late event、content reload
- [ ] 使用结构化 readiness 信号继续降低固定等待

## P1：Skill 编辑

- [ ] 单步编辑、排序、启停和删除
- [ ] 使用新 Snapshot 重新生成失效定位提示
- [ ] workflow 成功率和失败步骤指标
- [ ] 声明所需工具与权限，但不绕过全局确认

## P1：源码关联

- [ ] bounded `repo.read_file`
- [ ] TypeScript symbol/reference 查询
- [ ] API pathname → client/hook/response type
- [ ] DOM → component → prop/hook → API 证据链
- [ ] Git revision 与 branch 上下文

## P2：团队化

- [ ] DOM/page fingerprint 推荐
- [ ] 显式确认的跨 Tab workflow
- [ ] 签名的团队 Skill Registry
- [ ] Marketplace 自定义修改的三方合并
- [ ] 远程 Agent Server 的用户、仓库和工具授权

## 暂不实现

- 多窗口并发 Agent run
- 对话开始后的自动目标 Tab 重绑
- 模型生成 JavaScript、XPath、selector 或坐标动作
- 默认采集完整网络内容
- 无确认的发布、审批、发送、删除或真实交易

## 不变量

- 模型只使用最新 Snapshot ref。
- Skills 不增加浏览器权限。
- 每个 mutating action 必须有验证规则。
- 导航只证明页面变化，不证明任务完成。
- 普通循环不重复采集 Resource Timing。

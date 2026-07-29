# 页面观察、动作与验证

## 1. Page Snapshot

Content Script 不发送完整 DOM。普通 Snapshot 包含：

- URL、title、language、selectedText；
- 有界 mainText 和 headings；
- 视口、页面尺寸和滚动位置；
- 最多 200 个候选交互元素；
- Page Agent 风格的 `simplifiedDom`；
- `snapshotId`、`domVersion` 和捕获时间；
- 可选的一次性元素/截图上下文。

Resource Timing 只在用户明确询问性能、网络、请求或 API 时采集。普通动作与验证不会重复遍历资源列表。

## 2. 候选元素与 ref

候选元素来自受限 selector 集，并经过：

- 可见性和尺寸检查；
- 视口附近 700px 范围；
- top-layer/遮挡检查；
- 敏感字段标记；
- expanded control、关联 popup、变化元素优先级排序。

Content Script 为每个候选建立：

- 临时 `ref`：仅当前 Snapshot 可用；
- `fingerprint`：Bridge 校验后用于后台队列重绑；
- role、label、text、value 和几何信息；
- checked、selected、expanded、busy；
- controls、owns、activeDescendant、ownerId；
- `displayValue` 和 `selectedValues`。

Selector 保留在 Content Script 内部，只用于录制或本地定位提示，不是模型动作输入。

## 3. 动作白名单

| 动作 | 用途 | 关键限制 |
| --- | --- | --- |
| `click` | 按钮、链接、option、类按钮控件 | 目标可见、未遮挡、未禁用 |
| `fill` | 普通 input/textarea/contenteditable | 禁止敏感、readonly、自定义 combobox |
| `select` | 原生 `<select>` | 不支持 ARIA combobox |
| `scroll` | 页面或方向滚动 | 距离限制 0–2000px |
| `focus` | 聚焦控件 | 必须保留真实焦点 |
| `submit` | 原生 form | 非 form 在 Bridge 归一化为 click |
| `dismiss` | 当前最内层 popup/dialog | 不是任意坐标点击 |

每步执行前会重新校验 Snapshot id、URL、目标可见性、敏感性、readonly、disabled 和 top-layer。

## 4. Settle

等待按动作区分，不使用统一长 sleep：

| 动作 | 首次 settle 上限 |
| --- | --- |
| fill / focus | 160ms |
| combobox click | 1.2s，并等待关联 option |
| select / dismiss | 900ms |
| scroll | 700ms |
| 普通 click / submit | 1.8s |

click、submit、dismiss 在首次验证无结果时，可追加一次 mutation-aware delayed observation，最长 2.5s。路由转换 pending 时最多观察 5s。

AI 指针只是可见反馈。其移动与点击动画保持短时阻塞，不能成为动作主要耗时。

## 5. Snapshot diff

Diff 以 fingerprint 比较：

- URL/title 是否变化；
- 交互元素新增/删除；
- value、displayValue、selectedValues；
- disabled、checked、selected、expanded、busy、occluded。

“任意 DOM 有增删”不能直接证明动作成功。验证必须绑定目标或明确结果区域。

## 6. 动作验证

| 动作 | 成功证据 |
| --- | --- |
| fill/select | 目标值精确匹配 |
| option click | option selected、关联 combobox 最终值或 activeDescendant |
| checkbox/radio/switch | 目标状态变化；或出现有文字的下一可操作控件 |
| dismiss | expanded true→false 或受控 popup 消失，外层 dialog 保留 |
| focus | activeElement 与目标一致 |
| scroll | scrollX/scrollY 变化 |
| 普通 click/submit | 目标状态变化/消失、URL 变化或有意义结果区域 |

新增 `alert/status/dialog` 只有包含非空 label、text、value、displayValue 或 selectedValues 才是证据。空的 offscreen status 只表示路由可能开始。

## 7. Popup dismissal

Dismiss 的目标只能是：

- expanded combobox；
- 可见 listbox/menu；
- 属于该 popup 的已选择 option（仅作为锚点）；
- 最上层 dialog。

Popup 流程：

1. 发送 Escape；
2. 检查是否已经关闭；
3. 仍打开时，在 popup 外寻找非交互安全点；
4. 候选节点本身、祖先或后代包含交互控件时均拒绝，避免把代理 combobox 点击的普通 wrapper 误判为空白区域；
5. Modal 中搜索范围限制在 Modal 内容内，并优先检查标题区等内部非交互区域，不点击 backdrop；
6. Background 仅为当前运行的 top-frame Tab 派发 bounded trusted click；
7. 每次点击后重新检查 expanded 状态和受控 popup；仍打开时排除该目标并尝试下一个候选，最多三次，整体仍计为一次 dismiss；
8. 重新 Snapshot 并验证关闭。

模型不能提供坐标、backdrop、父 trigger、selector 或空白区域 ref。若找不到安全点，dismiss 失败。

## 8. 截图与视觉标记

截图策略是按需的：

- 用户主动选择元素/图片或附加视口；
- 初始页面明显依赖视觉内容；
- DOM readiness 后仍 blocked 的一次性恢复。

Visual Marks 在截图副本上绘制红色编号，编号映射到同一 Snapshot 的 ref。编号和坐标不是动作参数；页面变化会使截图和映射一起失效。

自动截图不会切换到其他 Tab，敏感页面会跳过。Local Codex 所需图片会写入私有临时目录，单 turn 后删除。

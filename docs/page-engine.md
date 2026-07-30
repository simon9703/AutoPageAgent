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
- 最上层 dialog、expanded combobox、受控 listbox/menu 和 option 优先；
- 虚拟列表把 ARIA option 放在零尺寸语义树时，可在同一受控 popup 层内将精确同名、唯一、可见且未遮挡的展示节点恢复为 option ref；不依赖组件 class，也不允许模糊文本或跨层匹配；
- dialog 打开时抑制其外部背景控件，expanded popup 抑制背景同语义候选；
- disabled 分页控件仍可观察，但不能执行。

Content Script 为每个候选建立：

- 临时 `ref`：仅当前 Snapshot 可用；
- `fingerprint`：Bridge 校验后用于后台队列重绑；
- role、label、text、value 和几何信息；
- checked、selected、expanded、busy；
- multiple、current、relation；
- controls、owns、activeDescendant、ownerId；
- layerId、parentLayerId；
- scrollable 与容器 scrollPosition；
- `displayValue` 和 `selectedValues`。

Selector 保留在 Content Script 内部，只用于录制或本地定位提示，不是模型动作输入。

## 3. 动作白名单

| 动作 | 用途 | 关键限制 |
| --- | --- | --- |
| `click` | 按钮、链接、option、类按钮控件 | 目标可见、未遮挡、未禁用 |
| `fill` | 普通 input/textarea/contenteditable | 禁止敏感、readonly、自定义 combobox |
| `select` | 原生 `<select>` | 不支持 ARIA combobox |
| `scroll` | 页面或可信滚动容器 | 距离限制 0–2000px；容器必须有最新 targetRef |
| `focus` | 聚焦控件 | 必须保留真实焦点 |
| `submit` | 原生 form | 非 form 在 Bridge 归一化为 click |

每步执行前会重新校验 Snapshot id、URL、目标可见性、敏感性、readonly、disabled 和 top-layer。

## 4. Settle

等待按动作区分，不使用统一长 sleep：

| 动作 | 首次 settle 上限 |
| --- | --- |
| fill / focus | 160ms |
| combobox click | 1.2s，并等待关联 option |
| select | 900ms |
| scroll | 700ms |
| 普通 click / submit | 1.8s |

click、submit 在首次验证无结果时，可追加一次 mutation-aware delayed observation，最长 2.5s。路由转换 pending 时最多观察 5s。

AI 指针只是可见反馈。其移动与点击动画保持短时阻塞，不能成为动作主要耗时。

## 5. Snapshot diff

Diff 以 fingerprint 比较：

- URL/title 是否变化；
- 交互元素新增/删除；
- value、displayValue、selectedValues；
- disabled、checked、selected、multiple、current、relation、expanded、busy、occluded；
- layer 层级和滚动容器位置。

“任意 DOM 有增删”不能直接证明动作成功。验证必须绑定目标或明确结果区域。

## 6. 动作验证

| 动作 | 成功证据 |
| --- | --- |
| fill/select | 目标值精确匹配 |
| option click | option selected、关联 combobox 最终值或 activeDescendant |
| checkbox/radio/switch | 目标状态变化；或出现有文字的下一可操作控件 |
| focus | activeElement 与目标一致 |
| scroll | 页面或目标容器 scroll position 变化 |
| pagination click | current、URL 或 collection signature 变化 |
| 普通 click/submit | 目标状态变化/消失、URL 变化或有意义结果区域 |

新增 `alert/status/dialog` 只有包含非空 label、text、value、displayValue 或 selectedValues 才是证据。空的 offscreen status 只表示路由可能开始。

## 7. Popup housekeeping

Popup close 属于 executor-owned housekeeping，不在 Provider action schema 中。dialog 不允许自动 dismiss；需要关闭 dialog 时，Provider 只能普通 click 当前 Snapshot 中显式的 Close/Cancel 控件。

Popup 流程：

1. 在页面内发送合成 Escape；
2. 检查是否已经关闭；
3. 仍打开时，请求 Background 通过 Chrome Debugger CDP 发送固定的 trusted Escape（`rawKeyDown -> keyUp`），随后立即 detach；
4. 再次检查 expanded 状态或受控 popup 是否消失；
5. 仍打开时，在 popup 外寻找非交互安全点；
6. 候选节点本身、祖先或后代包含交互控件时均拒绝，避免把代理 combobox 点击的普通 wrapper 误判为空白区域；
7. Modal 中搜索范围限制在 Modal 内容内，并优先检查标题区等内部非交互区域，不点击 backdrop；
8. Background 仅为当前运行的 top-frame Tab 派发 bounded trusted click；
9. 点击后 fresh Snapshot 检查 expanded 状态和受控 popup；只尝试一个安全点；
10. 重新 Snapshot 并验证关闭。

同一 owner 仍有 queued unselected option 时不关闭。下一目标在 popup 外或最后一个 queued option 已完成时才执行一次 housekeeping。trusted Escape 的按键内容由扩展固定，模型不能提供按键；安全点也由 Content Script 计算。两者均无效时立即失败，不循环尝试其他位置。

## 8. 截图与视觉标记

截图策略是按需的：

- 用户主动选择元素/图片或附加视口；
- 初始页面明显依赖视觉内容；
- DOM readiness 后仍 blocked 的一次性恢复。

Visual Marks 在截图副本上绘制红色编号，编号映射到同一 Snapshot 的 ref。编号和坐标不是动作参数；页面变化会使截图和映射一起失效。

自动截图不会切换到其他 Tab，敏感页面会跳过。Local Codex 所需图片会写入私有临时目录，单 turn 后删除。

# Vimium Link Hints 核心实现分析

> 参考仓库：[`philc/vimium`](https://github.com/philc/vimium)
> 本次基线：[`5aa29614bf1dce05e0d316f8c38722e17f9b38c3`](https://github.com/philc/vimium/commit/5aa29614bf1dce05e0d316f8c38722e17f9b38c3)（2026-07-25）
> 分析范围：可点击元素发现、字母提示生成、跨 frame 协调、键盘匹配、overlay 渲染、元素激活及其对 AutoPageAgent 的参考价值。

## 1. 结论

Vimium 的 Link Hints 是“人类键盘快速选择网页元素”的临时交互模式：

```text
按 f
  -> 所有 frame 收集可点击元素
  -> background 汇总 HintDescriptor
  -> 每个 frame 建立相同的全局 hint 顺序
  -> 页面插入字母 overlay
  -> 用户逐字输入
  -> 候选收缩到一个
  -> 所属 frame 激活真实 Element
  -> 删除 overlay 并退出模式
```

它不是 Agent 的 DOM snapshot，也没有长期稳定 ref。字母只在当前 Link Hints 模式内有效。

源码主入口：

- [`content_scripts/link_hints.js`](https://github.com/philc/vimium/blob/5aa29614bf1dce05e0d316f8c38722e17f9b38c3/content_scripts/link_hints.js)
- [`background_scripts/main.js`](https://github.com/philc/vimium/blob/5aa29614bf1dce05e0d316f8c38722e17f9b38c3/background_scripts/main.js)
- [`background_scripts/commands.js`](https://github.com/philc/vimium/blob/5aa29614bf1dce05e0d316f8c38722e17f9b38c3/background_scripts/commands.js)

## 2. 核心数据结构

### `LocalHint`

代表当前 frame 中的一个可操作目标：

- `element`：真实 DOM Element。
- `image`：image map 的关联图片。
- `rect`：提示标签应显示的位置，不一定等于元素完整 rect。
- `linkText`：过滤模式使用的文本。
- `showLinkText`：是否在标签中显示文本。
- `reason`：Frame、Scroll、Open 等特殊原因。
- `secondClassCitizen`：只有 tabindex、可信度较低的目标。
- `possibleFalsePositive`：可能只是包裹真实点击目标的祖先。

### `HintDescriptor`

用于跨 frame 传输的轻量描述：

- `frameId`
- `localIndex`
- `linkText`

它不传输 DOM Element；Element 始终只保留在所属 content script 的 `localHints` 中。

### `HintMarker`

表示页面上的提示标签及匹配状态：

- `hintDescriptor`
- `localHint`
- `hintString`
- `linkText`
- `element`：提示标签 DOM，不是业务目标 DOM。
- `markerRect`
- score 和稳定排序序号。

关系如下：

```text
hintString
  -> HintMarker
  -> HintDescriptor(frameId, localIndex)
  -> owner frame localHints[localIndex]
  -> LocalHint.element
```

## 3. 可点击元素发现

`LocalHints.getLocalHints()` 会遍历当前 document 的所有元素，并递归进入 open shadow root。

候选识别综合使用：

- `<a>`、`button`、`input`、`select`、`textarea` 等原生交互元素。
- 常见可点击 ARIA role。
- `contenteditable`。
- `onclick` 等属性。
- 特定 cursor 和页面结构启发式。
- 可滚动容器、`details`、frame body、image map area。
- `tabindex >= 0` 的次级候选。
- class 中含 `button` / `btn` 的低置信度候选。

它不会把所有候选直接显示出来，还会继续过滤：

1. 使用 `getVisibleClientRect()` 取得视口内可见 rect。
2. 对可能误判的 span/class button 检查附近后代，优先真实子交互元素。
3. 使用 `elementsFromPoint()` / `elementFromPoint()` 检查中心点和四角。
4. 如果目标被覆盖，删除提示。
5. 对只有 tabindex 的次级候选，只在没有更可靠重叠目标时保留。
6. 将 rect 转换为页面坐标，用于 overlay 定位。

Shadow DOM 命中时，`getElementFromPoint()` 会继续进入 shadow root，直到找到实际元素。

这一部分与 Agent DOM 候选扫描高度相关：Vimium 的重点不是“找到所有交互语义”，而是“找到用户当前能可靠点到的目标”。

## 4. 跨 frame 协调

Link Hints 不是只处理顶层 frame。

启动时：

1. 当前 frame 调用 `prepareToActivateMode()`。
2. 临时安装键盘阻塞模式，缓存按键，避免提示尚未准备好时触发其他命令。
3. background 向 tab 内各 frame 广播收集请求。
4. 每个 frame 生成自己的 `localHints` 和 `HintDescriptor[]`。
5. background 汇总 `frameId -> descriptors`。
6. 每个 frame 收到同一份全局 descriptors，并按 frame id 排序展开。
7. 所有 frame 创建相同的 marker matcher，保持选择状态同步。

用户每输入一个字符，状态会经 background 广播给其他 frame。每个 frame 都执行相同的候选过滤；最终只有拥有匹配 `LocalHint` 的 frame 执行真实动作。

这种设计避免跨 frame 传递 Element，也避免顶层 frame直接访问跨域 iframe DOM。

## 5. 字母提示生成

默认 `AlphabetHints` 使用用户配置的 `linkHintCharacters`，通常是主键盘区字符。

它要求字符集至少两个字符，否则会出现：

```text
1, 11, 111...
```

这种前缀无法唯一结束选择。

生成逻辑不是简单的十进制转换，而是构建一个前缀可选择的 hint 集合：

1. 从空字符串开始。
2. 取出一个已有前缀。
3. 为字符集中的每个字符生成 `ch + prefix`。
4. 直到剩余可用 hint 数达到元素数量。
5. 截取需要的数量。
6. 排序并反转字符，使短 hint 和相同首字符提示分散。

结果可能是：

```text
A  S  D  F  G
AA AS AD AF ...
```

用户输入字符后：

```js
marker.hintString.startsWith(matchString)
```

保留所有前缀匹配候选；只剩一个时激活。

## 6. Filter Hints

Vimium 还支持过滤模式：

- 标签主要使用数字字符集。
- 用户可以输入链接文本缩小候选。
- 匹配结果会评分并稳定排序。
- 剩余候选会重新编号。
- Tab / Shift+Tab 可切换 active hint。
- 最终用 Enter 或短暂停顿确认。

过滤模式适合页面候选非常多时，因为用户不必先视觉寻找字母，可以直接输入目标文字。

这与视觉 Agent 不同：模型本身已经同时读取 DOM 文本和截图，一般不需要再实现一套动态文字过滤 UI。

## 7. Overlay 渲染

Vimium 会在真实页面 DOM 中创建：

```html
<div id="vimium-hint-marker-container" class="vimium-reset">
  <div class="internal-vimium-hint-marker vimiumHintMarker">A</div>
  ...
</div>
```

提示标签作为顶层容器的直接子节点，而不是放进目标元素，原因包括：

- `input`、submit button 等元素不能包含子节点。
- 避免被目标自身布局影响。
- 便于统一调整 z-index 和隐藏状态。

支持 Popover API 时，容器使用 manual popover，获得更稳定的顶层显示；同时设置绝对定位、全页面宽高和 `overflow: visible`。

每个本地 marker 根据 `LocalHint.rect.left/top` 定位。用户输入后：

- 不匹配的 marker 设为 `display: none`。
- 匹配字符增加 `matchingCharacter` class。
- filter 模式的当前目标增加 `vimiumActiveHintMarker`。

提示重叠时，空格会触发 `rotateHints()`：

1. 计算当前可见 marker rect。
2. 用 rect 相交关系形成 stack。
3. 把每组最后一个 marker 移到最前。
4. 重新 append，改变遮挡顺序。

## 8. 键盘模式

`LinkHintsMode` 基于 Vimium 的通用 `Mode` / handler stack：

- 抑制页面收到 Link Hints 按键。
- Escape 或页面点击退出。
- Backspace 删除已输入字符；为空时退出。
- Tab 切换 active hint。
- Space 旋转重叠标签。
- Shift / Control 可临时切换当前 tab、新后台 tab、新前台 tab等打开方式。
- 支持重复次数和连续打开多个链接。

启动准备阶段会暂时缓存键盘事件，并设置 1 秒保护定时器，避免跨 frame 协调异常导致键盘一直被 Vimium 阻塞。

## 9. 目标激活

只剩一个匹配 marker 时：

1. 立即移除全部提示标签。
2. 如果目标属于当前 frame，从 `localHint.element` 取得真实元素。
3. 根据 `reason` 和目标类型决定动作。
4. frame focus、scroll、`details.open`、select、focus、click 分别处理。
5. 记录最后点击目标的 `WeakRef`。
6. 短暂显示点击 flash rect。
7. 广播成功退出，所有 frame 清理状态。

普通目标最终通过 `DomUtils.simulateClick()` 激活，可附带 meta/ctrl/shift/alt modifier，以支持新 tab、下载等行为。

Vimium 的安全模型是用户即时键盘操作，不是模型自主操作，因此没有 AutoPageAgent 的：

- `snapshotId`
- ref fingerprint
- 动作确认
- 逐步验证
- 完成证据
- 最大 action budget

## 10. Hint 为什么不能作为长期 ref

Vimium 每次进入 Link Hints 都重新：

- 扫描 DOM。
- 过滤可见/未遮挡目标。
- 汇总 frame。
- 生成 hint string。
- 创建 overlay。

滚动、弹窗、页面更新或重新进入模式后，字母都可能指向不同元素。它的正确生命周期是：

```text
activate mode -> type hint -> activate element -> destroy mode
```

因此不能把 `A`、`SD` 等提示直接存进 Skill 或 Agent 后续步骤。

## 11. 与 Browser Use 的本质差异

| 维度 | Vimium | Browser Use |
| --- | --- | --- |
| 目标 | 人类无鼠标浏览 | LLM 浏览器操作 |
| 提示 | 字母或过滤数字 | DOM index |
| 映射 | hint 到本 frame Element | index 到 EnhancedDOMTreeNode |
| UI | 页面 DOM overlay | 默认截图像素后处理 |
| 生命周期 | 一次 Link Hints 模式 | 一次浏览器状态 |
| 选择方式 | 实时 keydown 前缀匹配 | 模型结构化 action |
| 重叠处理 | 空格轮换 overlay | DOM/paint order/bbox 过滤 |
| 验证 | 用户直接观察 | Agent 后续 observation |

## 12. 对 AutoPageAgent 的参考

### 源码确认

- `elementsFromPoint()` 的中心点 + 四角命中可减少被遮挡候选。
- 递归 open shadow root 能覆盖普通 DOM 遍历遗漏。
- 次级 tabindex 候选应让位于真正 clickable 目标。
- overlay 标签重叠需要独立布局策略。
- 跨 frame 应传轻量 descriptor，不传 Element。

### 工程推断

如果未来增加“人工键盘选择元素”模式，可以复用：

```text
当前 snapshot ref
  -> 临时 hint string
  -> 用户键入
  -> hint -> 当前 ref
  -> 重新校验 snapshot
  -> 执行
```

但这应是独立的人机快捷模式，不应改变 Agent 的 ref 协议。

### 当前不需要实现

- 不为所有页面常驻字母 overlay。
- 不用字母替换 `data-ai-ref`。
- 不在视觉截图中同时显示数字和字母。
- 不把 Vimium 的 keyboard handler stack 引入 Agent 自动执行。
- 不把 overlay 插入页面后再截图；自动视觉分析继续在截图像素上绘制编号。

## 13. AutoPageAgent 当前选择

当前实现采用 Browser Use 风格的视觉编号，而不是 Vimium 字母：

```text
普通观察：DOM + data-ai-ref
视觉恢复：截图 + 数字 index
对齐关系：index -> 当前 ref
最终执行：snapshotId + ref
```

理由：

- 数字与现有 `simplifiedDom` 的 `[N]` 能直接复用。
- 视觉模型不需要学习用户自定义 hint 字符集。
- 不创建真实页面 overlay。
- 不触发页面 MutationObserver。
- 不会与网页键盘输入或快捷键冲突。
- 功能可由后台内部变量整体关闭，不需要产品 UI。

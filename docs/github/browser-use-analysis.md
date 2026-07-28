# Browser Use 元素索引与视觉标记分析

> 参考仓库：[`browser-use/browser-use`](https://github.com/browser-use/browser-use)
> 本次基线：[`f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc`](https://github.com/browser-use/browser-use/commit/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc)（2026-07-27，v0.13.7）
> 分析范围：DOM/AX 采集、交互元素编号、`selector_map`、截图标记、按索引执行及其与 AutoPageAgent 的差异。

## 1. 结论

Browser Use 的相关核心不是“给真实网页元素永久写入 index”，而是为每次序列化后的可交互元素建立临时编号：

```text
CDP DOMSnapshot + Accessibility Tree
  -> EnhancedDOMTree
  -> 过滤、压缩、分配 index
  -> selector_map[index] = EnhancedDOMTreeNode
  -> 同一 index 同时出现在 LLM DOM 文本和视觉截图
  -> 模型返回 index
  -> 从当前 selector_map 取节点并执行
```

它与 Vimium 的字母提示表面相似，但服务对象不同：

- Browser Use 的 index 是模型动作协议的一部分。
- Vimium 的字母是人类键盘选择协议。
- Browser Use 默认在截图像素上后处理边框和编号，不依赖页面中的提示 DOM。
- Browser Use 也保留 `dom_highlight_elements` 调试开关，但默认关闭。

## 2. 浏览器状态获取

`DOMWatchdog` 处理浏览器状态请求，并行启动两个任务：

1. `_build_dom_tree_without_highlights()` 构建 DOM 状态。
2. `_capture_clean_screenshot()` 截取未注入提示层的当前视口。

DOM 构建通过 `DomService.get_serialized_dom_tree()` 完成，结果包含：

- `SerializedDOMState`
- `EnhancedDOMTree`
- 分阶段 timing 信息

状态还附带当前 URL、标题、tab、页面尺寸、滚动距离、浏览器错误、网络请求和分页按钮等信息。完成后会缓存：

```text
BrowserStateSummary
  ├─ dom_state
  │   └─ selector_map
  ├─ screenshot
  ├─ page_info
  └─ tabs / errors / events
```

源码：

- [`browser_use/browser/watchdogs/dom_watchdog.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/browser/watchdogs/dom_watchdog.py)
- [`browser_use/dom/service.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/dom/service.py)
- [`browser_use/browser/views.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/browser/views.py)

## 3. DOM、AX 与几何信息融合

`DomService` 通过 CDP 获取 DOM snapshot、Accessibility Tree、frame 和布局信息，再组装为 `EnhancedDOMTreeNode`。节点可以包含：

- DOM tag、attribute、text。
- AX role、name、description 和 properties。
- backend node id、frame/session 信息。
- bounds、client rect、scroll rect、absolute position。
- iframe、shadow root 和 content document。

可见性判断不只检查 `display`、`visibility` 和 `opacity`，还结合：

- 是否有有效 bounds。
- 当前 viewport。
- 父 document 的 scroll offset。
- iframe 在父页面中的偏移和 iframe 自身 viewport。
- 可配置的 viewport threshold。

因此编号来源不是简单的 `querySelectorAll("button,a,input")`，而是 CDP DOM、AX 语义、布局和 frame 信息融合后的节点树。

## 4. 序列化与 index 分配

`DOMTreeSerializer.serialize_accessible_elements()` 每轮都会重置：

```python
self._interactive_counter = 1
self._selector_map = {}
self._reserved_backend_node_ids = set()
self._next_synthetic_index = 1
```

随后按顺序执行：

1. `_create_simplified_tree()`：创建简化节点并检测 clickable。
2. `PaintOrderRemover`：根据绘制顺序处理被覆盖或重复节点。
3. `_optimize_tree()`：删除对模型没有价值的中间父节点。
4. `_apply_bounding_box_filtering()`：处理几何包含和重复交互区域。
5. `_reserve_backend_node_ids()`：为可直接使用 backend node id 的节点保留编号。
6. `_assign_interactive_indices_and_mark_new_nodes()`：分配最终 index，写入 `selector_map`。

核心数据关系是：

```text
index -> EnhancedDOMTreeNode
```

不是：

```text
index -> CSS selector
```

编号在每次新序列化时重新生成，所以它只能解释当前浏览器状态，不能作为跨页面或长期稳定 ID。序列化器可以接收上一轮缓存，用于标记新节点和进行状态比较，但动作查找仍依赖当前缓存的 `selector_map`。

源码：

- [`browser_use/dom/serializer/serializer.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/dom/serializer/serializer.py)
- [`browser_use/dom/views.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/dom/views.py)
- [`browser_use/dom/serializer/paint_order.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/dom/serializer/paint_order.py)
- [`browser_use/dom/serializer/clickable_elements.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/dom/serializer/clickable_elements.py)

## 5. 模型看到的 DOM index

序列化后的交互节点会在 LLM 表示中携带 index，例如：

```text
[12]<input placeholder="Search">
[13]<button>Search</button>
[14]<a>Next page</a>
```

模型动作使用 index：

```json
{
  "click": {
    "index": 13
  }
}
```

Browser Use 把数字本身作为正式动作目标，不需要再转换为另一个公开 ref。真正执行时，`BrowserSession.get_element_by_index()` 从当前 `selector_map` 查找节点。

如果 index 不存在，执行器返回：

```text
Element index N not available - page may have changed.
Try refreshing browser state.
```

这说明 index 明确是短生命周期引用，页面变化后需要重新获取浏览器状态。

## 6. 截图 Set-of-Mark

Browser Use 当前采用“先截干净图片，再在 Python 中绘制”的方式：

```text
capture clean screenshot
  + selector_map
  + device pixel ratio
  -> PIL ImageDraw
  -> highlighted screenshot
```

`python_highlights.py` 的主要处理：

1. Base64 解码截图。
2. 使用 PIL 创建绘图上下文。
3. 遍历 `selector_map.items()`。
4. 读取节点的 `absolute_position`。
5. 用 device pixel ratio 将 CSS 像素转换为截图像素。
6. 裁剪到图像边界，过滤小于 2px 的区域。
7. 按 button、input、select、link、textarea 等类型选择颜色。
8. 绘制虚线边框和 index 标签。
9. 编码回 Base64 PNG。

关键点是绘制时直接使用 `selector_map` 的 key：

```text
element_id = 模型 DOM 中的 index = 截图标签 index
```

这样 DOM 文本和截图不会维护两套编号。

`filter_highlight_ids=true` 时，有足够短的有意义文本才显示数字标签；关闭过滤则始终显示 index。即使某个元素不显示数字，仍可以显示类型颜色边框。

源码：

- [`browser_use/browser/python_highlights.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/browser/python_highlights.py)
- [`browser_use/browser/profile.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/browser/profile.py)

## 7. 两类高亮开关

`BrowserProfile` 包含：

| 配置 | 默认值 | 含义 |
| --- | ---: | --- |
| `highlight_elements` | `true` | 为交互元素生成高亮视觉信息 |
| `dom_highlight_elements` | `false` | 在浏览器 DOM 中显示调试高亮 |
| `filter_highlight_ids` | `true` | 根据元素有意义文本长度决定是否显示 index |

这两类高亮不应混淆：

- Python screenshot highlight 是传给视觉模型的图片后处理。
- DOM highlight 是浏览器页面内的调试或演示显示。

默认不依赖 DOM 高亮意味着截图标记不会污染网页树，不会成为下一轮 DOM snapshot 的业务元素，也不会因为页面 CSS 继承而改变。

## 8. 按 index 执行动作

`tools/service.py` 注册 click、input、dropdown、scroll、navigate、tab 等动作。按 index 点击的流程：

```text
model index
  -> browser_session.get_element_by_index(index)
  -> selector_map[index]
  -> ClickElementEvent(node)
  -> CDP/browser watchdog 执行
  -> ActionResult
```

执行层会：

- 拒绝 index 0。
- 处理找不到 index 的过期状态。
- 记录点击元素描述。
- 点击前异步显示交互高亮。
- 检测新 tab 并自动切换。
- 对 `<select>` 和 file input 使用专门能力。
- 返回执行 metadata。

Browser Use 还可以启用坐标点击；坐标会根据 LLM 图片尺寸换算回原 viewport。这与 AutoPageAgent 的安全边界不同，不能直接照搬。

源码：

- [`browser_use/tools/service.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/tools/service.py)
- [`browser_use/browser/session.py`](https://github.com/browser-use/browser-use/blob/f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc/browser_use/browser/session.py)

## 9. 页面变化与缓存

`DOMWatchdog` 把当前 `selector_map` 同时写入自身和 `BrowserSession` 缓存。动作执行从这份缓存查节点；需要新状态时重新构建。

这带来两个边界：

- index 不应跨新 observation 使用。
- 找不到 index 时应刷新状态，而不是凭旧坐标重试。

Browser Use 已经把“可能页面已变化”作为 index 缺失的主要错误提示，但它的正式动作协议仍允许 index 和可选坐标；AutoPageAgent 应继续保留更严格的 `snapshotId + ref + fingerprint` 校验。

## 10. 与 Vimium 的本质差异

| 维度 | Browser Use | Vimium |
| --- | --- | --- |
| 使用者 | LLM | 人类键盘用户 |
| 标识 | 数字 index | 字母串或过滤模式数字 |
| 生命周期 | 当前浏览器状态 | 当前 Link Hints 模式 |
| 映射 | `index -> EnhancedDOMTreeNode` | `hint -> LocalHint -> Element` |
| 展示 | 默认截图后处理 | 页面内真实 overlay |
| 输入 | 模型 JSON action | keydown 字符序列 |
| 跨 frame | CDP/Enhanced DOM 聚合 | background 协调各 frame descriptor |
| 最终动作 | CDP/event action | 模拟 click/select/focus 等 |

因此“Browser Use 也像 Vimium 一样给元素编号”只在视觉结果上成立，内部协议和目标完全不同。

## 11. AutoPageAgent 已采用的部分

当前 AutoPageAgent 的对应链路：

```text
PageSnapshot.elements[position]
  -> simplifiedDom 全局 [N]
  -> automatic screenshot 上绘制同一个 N
  -> visualMarks: [{ index, ref }]
  -> 模型仍返回 current data-ai-ref
  -> snapshotId + URL + domVersion 校验
  -> ref 执行动作
```

明确保留的差异：

- 数字只帮助视觉对齐，不是可执行动作 target。
- 不开放坐标点击。
- 不把 index 替换成 ref。
- 截图前后都验证 snapshot、URL 和 DOM version。
- 只在自动视觉分析截图中按需绘制。
- 标记功能由后台内部变量控制，不进入页面或侧栏 UI。

## 12. 可继续参考的能力

### 源码确认

- DOM 和截图并行采集，降低单步观察延迟。
- screenshot 使用同一 `selector_map` key，避免视觉/文本编号漂移。
- DPR 和图片边界转换集中处理。
- 页面变化导致 index 丢失时刷新状态。
- DOM 高亮与截图高亮使用不同开关。

### 工程推断

- AutoPageAgent 可继续优化重叠标签布局，避免小控件编号遮挡文字。
- 可按元素文字长度决定“只画边框”还是“边框 + 数字”。
- 可在截图尺寸变化时记录显式 `scaleX/scaleY` 诊断信息。

### 不建议照搬

- 不采用坐标作为模型可执行动作目标。
- 不让模型直接使用裸 index，继续使用当前 snapshot 的 ref。
- 不默认每一步都采集视觉截图。
- 不把 Browser Use 的通用 CDP 权限直接移入网页 content script。

# Page Agent-inspired DOM interaction

Auto Page Agent does not depend on Alibaba Page Agent. It adopts a small set of its demonstrated interaction principles while preserving the extension's existing security boundary.

## Adopted ideas

- Build a fresh index before an action plan and keep the live element map inside the page.
- Give the model compact numbered interactive elements instead of raw full-page HTML.
- Include viewport, page size, scroll position, and content-above/below hints.
- Prefer visible top-layer controls and exclude obscured or far-away nodes.
- Scroll a target into view before acting and emit realistic pointer/mouse events for clicks.
- Show a visual pointer and target ring during automation.

## Simplified implementation

The content script scans a bounded interactive selector set, keeps at most 160 elements within a 700-pixel viewport expansion, rejects hidden or obscured controls, and emits lines such as:

```text
[1]<button data-ai-ref="element-1" role="button" aria-label="Save">Save</button>
```

The model does not receive CSS selectors, XPath, live node handles, or arbitrary JavaScript execution. It returns an ephemeral `targetRef`; the bridge validates that ref against the current snapshot before the content script resolves it.

## Deliberate differences

- Every generated plan requires confirmation.
- Sensitive fields are redacted and cannot be filled.
- Arbitrary page JavaScript is not a model tool.
- The implementation remains extension-native and does not import Page Agent runtime code.
- Screenshot and selected-image context complement the DOM, but DOM refs remain the only action targets.

References: [Alibaba Page Agent](https://github.com/alibaba/page-agent), its [PageController](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/PageController.ts), and [DOM actions](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/actions.ts).

# Architecture

## Product boundary

Auto Page Agent connects four evidence domains:

```text
browser page <-> network activity <-> source repository
```

The MVP implements the browser-page domain, lightweight performance evidence, local repository evidence search, a local agent bridge, and reusable skills. Translation-catalog analysis is deferred but marked with `TODO(i18n)` extension points.

## Runtime components

### Chrome extension

- **Side Panel** is a React + Tailwind interface with a conversation-bound page summary, icon-first page tools, modal Skill/recording management, a fixed composer, and an adjacent action-approval card.
- **Background service worker** owns the Chrome Native Messaging connection and routes messages to explicit target tab ids.
- **Content script** creates a bounded snapshot and executes approved actions.
- **Element picker** captures source metadata and stable textual/attribute clues for repository analysis.
- **Screenshot capture** uses `captureVisibleTab`, keeps the JPEG data URL inside the extension, and attaches it only when the user sends a message while the preview is selected.
- **Workflow recorder** captures bounded declarative actions plus session-only key-frame screenshots and never records sensitive values.

The extension source follows entrypoint-first boundaries:

```text
packages/extension/src/
├── background.ts          # Chrome listeners, message routing, agent-loop orchestration
├── background/
│   ├── bridge-client.ts   # Native Messaging request/event transport
│   ├── tabs.ts            # explicit target-tab lookup, activation, content messaging
│   ├── screenshot.ts      # viewport and selected-element capture
│   ├── recording.ts       # session-backed recorder lifecycle
│   └── pending-agent-run.ts
├── content.ts             # minimal content-script bootstrap
├── content/
│   ├── runtime.ts         # message routing, snapshots, actions, verification
│   ├── dom.ts             # bounded DOM inspection and interaction helpers
│   ├── recording.ts       # page-event recording and safe replay
│   ├── selection.ts       # element/image selection lifecycle
│   ├── agent-visuals.ts   # picker and persistent selection overlays
│   └── agent-activity.ts  # action pointer and isolated activity frame
├── sidepanel.tsx          # React mount only
└── sidepanel/
    ├── App.tsx            # stable component entry
    ├── controller.tsx     # Chrome state, persistence, workflow orchestration
    ├── conversation.ts    # pure continuation and message formatting rules
    ├── components.tsx     # presentation-only UI components
    ├── formatters.ts      # pure presentation formatting
    └── i18n/              # i18next initialization and locale resources
```

Entrypoints stay minimal. Runtime/controller modules own browser lifecycle and orchestration, while feature modules own one bounded concern. Cross-process protocol types remain in `packages/shared`.

The normal agent snapshot contains page metadata, selected text, a limited body-text extraction, headings, at most 200 interactive elements near the viewport, a Page Agent-inspired simplified DOM, and page/scroll geometry. Performance evidence is an optional capability: Navigation and Resource Timing are attached only when the task explicitly asks about performance, network, requests, or APIs. Repository analysis reads the same evidence through a separate on-demand message. Ordinary action and verification snapshots never repeat Resource Timing collection. DOM nodes remain inside the content script and are represented externally by ephemeral refs. Candidate elements are bounded to a 700-pixel expansion around the viewport and checked against the browser's top-layer hit target before inclusion.

The side panel can attach one inspected element, page image, or captured viewport to the next message. The Responses provider sends the selected visual as an image input. Local Codex receives the selected element or screenshot metadata, but screenshot data URLs are removed from its text prompt. A successful initial agent response consumes the pending context and clears it from the composer. The user message keeps a compact, read-only attachment summary across side-panel reloads, while later agent-history requests omit the summary and all screenshot binary data.

### Conversation and tab lifecycle

A browser window owns one current conversation. Its session is stored under a window-scoped key. Before the first message, an empty conversation follows the active HTTP(S) tab; the first message locks its target. Browser focus and agent routing are separate after that point:

- changing the browser's active tab updates the target while the conversation is empty, then only updates the viewing indicator after the conversation starts;
- questions, Skills, repository analysis, recording, and DOM actions continue to use the conversation target;
- the page summary activates the bound tab but never rebinds the conversation;
- **New** discards the current conversation and creates a new empty conversation that follows the currently viewed tab until its first message;
- the adjacent History list restores saved chat and operation events, or deletes a log with `×`;
- restored history reuses its original tab only when that tab still exists; it never silently rebinds to the active tab;
- selection and screenshot commands activate the target because they depend on a visible page;
- navigation inside the target tab remains in the same conversation;
- closing the target stops an active run and requires **New**; it never falls back to another open tab;
- agent events and returned results are accepted only when `windowId`, `conversationId`, and `targetTabId` all match;
- **New** remains disabled while a run is active; stopping keeps the UI busy until cancellation has reached the running provider;
- a `needs_user` decision persists the original task and combines the next user reply with it instead of starting an unrelated task; bounded options are rendered as a confirmation card with the recommended or first option preselected.

Every planned run persists its `windowId`, `conversationId`, `tabId`, initial page URL, and snapshot id. The confirmed observe-act-verify loop reuses that immutable scope for every action, navigation recovery, observation, and verification step. It never falls back to the currently active browser tab. Pending selected-element context is keyed by target tab so another window cannot overwrite it.

### Local bridge

The bridge is registered once as `com.auto_page_agent.bridge`. Chrome launches it on demand over stdin/stdout Native Messaging and stops it when the browser connection ends. It:

1. accepts a page snapshot and user task;
2. selects applicable `SKILL.md` workflows;
3. routes the request to authenticated local Codex or the configured Responses API;
4. reuses provider conversation state until the user starts a new conversation, which clears both Codex thread and Responses chaining state;
5. parses and validates the JSON decision;
6. returns an answer, confirmation-required action plan, evidence-backed completion, blocked state, or request for user input with an optional validated choice list and recommendation.

The bridge follows a stable-entrypoint, feature-folder structure:

```text
packages/bridge/src/
├── index.ts                    # Native Messaging process bootstrap
├── bridge/message-router.ts    # request dispatch and active-run lifecycle
├── agent.ts                    # stable public barrel
├── agent/
│   ├── router.ts               # provider selection
│   ├── providers/              # Codex and Responses adapters
│   ├── prompt.ts               # model context construction
│   ├── responses.ts            # Responses schema and SSE parsing
│   └── decision.ts             # normalized, fail-closed decisions
├── data-paths.ts               # shared durable user-data root
├── logs.ts                     # conversation and operation history persistence
├── skills.ts                   # Registry/Marketplace persistence API
└── skills/
    ├── model.ts                # internal loaded models
    ├── selection.ts            # task/page ranking
    ├── page-patterns.ts        # page scope validation and matching
    ├── workflow.ts             # declarative workflow generation
    └── utils.ts                # pure normalization helpers
```

Shared contracts use the same domain split. `packages/shared/src/index.ts` is only a compatibility barrel; browser snapshots/actions, Agent decisions, chat, repository evidence, Skills, events, and transport messages live in separate files. This keeps protocol dependencies explicit while preserving existing `@auto-page-agent/shared` imports.

The bridge keeps user data outside the extension package. Skills live under `~/.auto-page-agent/skills`; bounded conversation logs live under the sibling `~/.auto-page-agent/logs` directory. Log writes carry a monotonic conversation revision so an older async write cannot replace newer messages or events. Persisted operation events omit ephemeral DOM refs, and screenshot binaries remain session-only.

The native-host manifest allowlists the stable extension id derived from `manifest.json`. The installer copies built bridge/shared assets and bundled Skills into the user's application-support directory; no TCP port or separately started dev process is involved. The side panel checks both bridge reachability and `account/read` during initialization. It exposes **Reconnect** and disables sending until local Codex is available and authenticated.

After the initial plan is confirmed, the extension owns the V2 runtime loop. The provider may return the complete ordered sequence whose targets are already present in the current snapshot; the bridge validates every ref, rejects an oversized or partially invalid plan instead of truncating it, and attaches a trusted target fingerprint to each target step. The approval card displays the whole sequence once. The extension then executes one constrained action at a time, waits for the page effect with an action-specific settle budget, captures a fresh structural snapshot, computes a fingerprint-based diff, and verifies the expected state. When the action succeeds without navigation, the background uniquely matches the next fingerprint in the fresh snapshot, replaces its ephemeral ref, and continues the local queue without another provider call. It asks the provider again only when the queue ends, verification fails, navigation or context replacement occurs, or the next target is missing or ambiguous. Each continuation request carries that fresh snapshot once; compact loop metadata contains the last action, verification, recovery signal, and remaining budget, while full Skill bodies and repeated conversation context remain in the existing provider thread rather than being resent on every step.

Direct state actions such as ordinary fill and focus use a short wait. A readonly or custom ARIA combobox remains observable and clickable but cannot be filled or selected directly: clicking it polls only the popup referenced by `aria-controls` or `aria-owns` for a visible option for up to 1.2 seconds, then captures a fresh snapshot with new refs. Because a dynamic option does not exist in the original snapshot, it is never queued in advance. The next provider turn clicks the exact visible option from the fresh snapshot. Snapshots expose bounded `displayValue` and `selectedValues` derived from associated `aria-selected=true` options or visible selection labels, so single- and multi-select verification does not depend on a hidden input value. When click, submit, or dismiss has no verified effect in its first observation, the content script performs one mutation-aware delayed observation for at most 2.5 seconds; other actions do not inherit this extra wait. A newly added alert, dialog, or status counts as result evidence only when it exposes a non-empty accessible label, text, value, or selected/display value. An empty offscreen alert/status marks a pending route transition instead: click/submit observation continues until the URL changes, a non-empty title/heading/body context changes, or a meaningful result region appears. If none is observed within the bounded wait, verification fails. Dynamic options use lightweight ARIA selectors and ephemeral refs; zero-size, covered, and disabled candidates remain excluded. Native `select` remains the only target accepted by the `select` action. Buttons and button-like controls always use `click`, regardless of labels such as Submit, Pay, Confirm, or Top Up; provider output that incorrectly assigns `submit` to a non-form target is normalized to `click`, and the content runtime keeps the same fallback.

Multi-select popups use the constrained `dismiss` action after all required unselected options have been chosen. Its target must be a latest-snapshot ref for an expanded combobox, visible listbox/menu, or topmost dialog. For a combobox/listbox/menu, the content runtime resolves the visible popup boundary—including a visible ancestor when the ARIA listbox itself is zero-sized—and selects one verified non-interactive exterior DOM element. Inside a Modal, the search stays in Modal content outside the dropdown; otherwise it stays in the viewport outside the popup. Buttons, links, inputs, focusable controls, pointer cursors, and the agent overlay are rejected, so the previous input cannot become the fallback. The runtime dispatches the pointer/mouse sequence and invokes that resolved element's own `click()` method, then checks the live expanded state and popup visibility. If the exterior element click did not close the popup, or no safe exterior element exists, Escape runs inside the same dismiss action. It then captures one fresh snapshot and verifies an exact `aria-expanded: true -> false` transition or controlled-popup disappearance; all internal strategies produce only one verification and at most one failure. Existing outer dialogs must remain present when an inner popup is dismissed; an open dropdown blocks dialog dismissal. A filled dialog requires a bridge-attached trusted authorization derived from an explicit cancel/close request in the original user task; provider-authored flags are ignored. A snapshot-visible close button or backdrop continues to use ordinary `click`; model-authored coordinates, selectors, XPath, CSS-framework class names, parent-trigger lookup, repeated combobox clicking, and blind ancestor clicking are never accepted.

If a delayed SPA transition changes the URL, meaningful document context confirms the destination, a full reload replaces the content-script context, the snapshot expires, or the target disappears before dispatch, the old snapshot and refs remain invalid: the background waits for the bound tab, reads the page again, discards the remaining queue, clears earlier verification failures, and asks the provider to re-plan from the fresh snapshot. This re-observation is not a verification failure and a stale action rejected before dispatch does not consume an action step.

Navigation confirms only that page context changed; it does not prove that destination data is ready for a decision. When the provider first returns `blocked` after an action or re-observation boundary, the background performs one bounded readiness observation for that boundary. It compares URL, title, headings, bounded main text, and semantic control state while ignoring snapshot ids, fresh refs, timestamps, and layout-only churn. Visible `aria-busy=true` and `role=progressbar` controls hold the observation open; a changed semantic snapshot is returned after a short quiet window, with continuously changing pages falling back to their latest changed snapshot. The provider then replans from fresh refs. If no meaningful change occurs within six seconds or the remaining global budget, the original blocked result is final. This handles asynchronously rendered lists, forms, and submission results without page-specific API names, CSS classes, fixed business data, or repeated retries.

A completion claim whose evidence is absent from the fresh snapshot receives one bounded recovery turn to locate or reveal exact success evidence. If the second claim still cannot be verified, the run reports that the action may have been submitted but completion remains unconfirmed. The global loop still stops only on evidence-backed completion, a blocked/needs-user decision, two consecutive execution failures, eight executed actions, or 90 seconds. Readiness observation does not consume an action step or reset verification failures. Navigation and successful dispatch are never themselves proof of task completion.

Observe and plan remain internal runtime phases. They are not rendered as synthetic timeline entries because they add no user-visible evidence. Structured provider output is also kept internal: partial JSON tokens are protocol data, not useful progress. The timeline contains only real action, verification, completion, and error events. The initial action plan is shown once in the approval card rather than duplicated as an assistant message. Final assistant messages contain the user-facing result only; internal action counts remain in the status/timeline UI.

Completion is evaluated against the latest snapshot, including the destination page after navigation. At least one submitted evidence item must be exact text or a URL present in that snapshot; matched evidence is retained and extra explanation-like items are ignored. A claim with no matching evidence still receives one bounded recovery turn. Click, submit, and scroll actions also require an observable page effect before verification succeeds.

### Agent provider router

`AgentRouter` supports `auto`, `codex`, and `openai` modes. `auto` prefers an authenticated local Codex app-server and falls back to the Responses API only when `OPENAI_API_KEY` is configured. Provider secrets stay in the bridge process and are never sent to the extension or page.

### Codex app-server adapter

The bridge discovers the Codex executable, launches `codex app-server --listen stdio://`, initializes it, checks `account/read`, sends JSON-RPC requests, and consumes newline-delimited notifications. The runtime status is cached briefly so an active loop does not repeat the same account lookup on every turn. Provider API-key environment variables are removed from the spawned process; primary agent authentication uses the user's existing ChatGPT/Codex OAuth login. API-key Codex sessions are not used for main agent prompts, matching Chromex's boundary. A bridge-process conversation id maps to a reusable Codex thread.

### Responses API adapter

`OpenAIResponsesProvider` reads `OPENAI_API_KEY` only from the bridge environment, requests schema-constrained decisions, and chains turns with `previous_response_id`. The default model can be overridden with `OPENAI_MODEL`. This is a separate provider rather than API-key authentication for `codex app-server`, preserving Chromex's authentication boundary while supporting the requested direct API mode.

## Agent decision protocol

An analysis result:

```json
{"kind":"answer","content":"The page contains..."}
```

An action result:

```json
{
  "kind": "action_plan",
  "snapshotId": "...",
  "summary": "Fill the search field",
  "requiresConfirmation": true,
  "confidence": 0.91,
  "steps": [
    {"action":"fill","targetRef":"element-3","value":"BTC","reason":"User requested this query"}
  ]
}
```

A completed browser task:

```json
{
  "kind": "complete",
  "summary": "BTC details are open",
  "evidence": ["The current page heading is BTC and the details panel is visible"]
}
```

Other terminal or paused states:

```json
{"kind":"blocked","reason":"The page requires login","recoverable":false}
```

```json
{"kind":"needs_user","question":"Which account should be selected?","options":["Personal","Business"],"recommendedOption":"Personal"}
```

Invariant rules:

- refs must exist in the supplied snapshot;
- refs expire whenever a new snapshot is generated;
- no model-generated selector, XPath, or JavaScript is accepted;
- the current runtime accepts one action before re-observing;
- values are length-limited;
- all MVP plans require explicit confirmation.
- `answer` is only a non-operational response;
- after browser execution starts, only `complete` can report success;
- `complete` is rejected when it has no current-page evidence;
- invalid or unmatched actions normalize to `blocked`, never to a successful answer.

## Provider interface

Both local and remote runtimes should implement:

```ts
interface AgentProvider {
  status(): Promise<AgentRuntimeStatus>;
  run(
    task: string,
    snapshot: PageSnapshot,
    context: { conversationId: string; history: ChatMessage[] },
  ): Promise<AgentDecision>;
}
```

Implementations:

- `CodexProvider`: local Codex app-server with reusable threads and local Skill context.
- `OpenAIResponsesProvider`: direct Responses API with structured decisions and response chaining.
- `CompanyAgentProvider`: planned authenticated remote repository and internal platform access.

## Page-to-code correlation

The future evidence resolver should combine, in descending confidence order:

1. build-time `data-component`, `data-source`, and `data-repo` metadata;
2. private source maps retrieved by the company server using build revision;
3. React component/Fiber metadata in development and test environments;
4. API URL, response field, i18n key, visible text, and symbol searches;
5. semantic inference, always labeled as inference.

Every explanation should include its evidence and confidence rather than presenting repository search guesses as facts.

## Local repository evidence search

Repository roots come from `auto-page-agent.config.json` or `AUTO_PAGE_AGENT_REPOS`. The bridge validates absolute directory paths and invokes `rg` directly with argument arrays, fixed-string matching, bounded results, timeouts, and build/dependency exclusions. No selected text or model output is interpreted as a shell command.

The current search returns evidence candidates; it does not yet claim an end-to-end data flow. The next resolver layer will use TypeScript symbols and imports to trace component -> hook -> API client -> response type.

Resource Timing entries initiated by `fetch` or `xmlhttprequest` are normalized without query strings and used as low-confidence API-path search terms. This provides endpoint candidates without claiming that a page-level request belongs to the selected element.

## Recorded automation Skills

The content script records supported user interactions as declarative steps: live debounced text/contenteditable input, checkbox/radio state, selects, clicks, submits, window or scroll-container positions, sanitized selectors, page URLs, and accessible labels. The background worker owns recorder state, adds navigation steps after same-tab loads, and re-arms recording when the content script reloads. It also stores at most 12 compressed session-only screenshots captured at the start, after key actions/navigation, or on explicit request. A test replay is explicit and confirmation-gated.

When saved, the bridge validates every URL and action, bounds the workflow to 100 steps, removes all recorded values, and replaces non-sensitive form values with named `{{variables}}`. Screenshot binaries never enter the durable workflow. Each generated folder contains instructions in `SKILL.md` and machine-readable configuration in `workflow.json`; both are loaded into the Codex planning context. Selectors are hints, not trusted commands, and current targets must be revalidated before execution.

The Registry supports explicit Skill selection, create/update/delete, portable JSON import/export, and Marketplace reinstall after deletion. The conversation summary flow generates an editable page-scoped draft from recent chat messages, Agent action/verification notes, and recorded steps; it still uses the same validated save boundary.

The Skill discovery endpoint classifies hand-written Skills without workflow metadata as global. Recorded Skills match only pages with the same HTTP(S) origin and the recorded start-path prefix. Page-scoped Skills sort before global capabilities in the side panel, and unrelated page workflows are excluded from the Codex prompt as well as the visible function list.

Workflow schema v2 adds persistent `enabled` and `pagePatterns` fields. Pattern configuration rejects wildcard origins, credentials, queries, fragments, unsupported characters, and lists over 20 entries. Disabled workflows may be returned for management on a matching page, but the agent selector always filters them out.

## UI localization and deferred translation analysis

The side-panel interface uses `i18next` and `react-i18next`, with semantic English keys and a Simplified Chinese locale under `sidepanel/i18n/`. Product names such as Skills, Codex, and Auto Page Agent remain unchanged.

Repository-level translation intelligence is still outside the current implementation. The shared protocol, element metadata collector, and repository query builder contain `TODO(i18n)` markers for a later `data-i18n-key` and translation-catalog provider without coupling that work to the current source/API flow.

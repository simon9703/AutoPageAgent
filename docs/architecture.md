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
- **Background service worker** owns the localhost connection and routes messages to explicit target tab ids.
- **Content script** creates a bounded snapshot and executes approved actions.
- **Element picker** captures source metadata and stable textual/attribute clues for repository analysis.
- **Screenshot capture** uses `captureVisibleTab`, keeps the JPEG data URL inside the extension, and attaches it only when the user sends a message while the preview is selected.
- **Workflow recorder** captures bounded declarative actions in Chrome session storage and never records sensitive values.

The extension source follows entrypoint-first boundaries:

```text
packages/extension/src/
├── background.ts          # Chrome listeners, message routing, agent-loop orchestration
├── background/
│   ├── bridge-client.ts   # localhost WebSocket request/event transport
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
    └── formatters.ts      # pure presentation formatting
```

Entrypoints stay minimal. Runtime/controller modules own browser lifecycle and orchestration, while feature modules own one bounded concern. Cross-process protocol types remain in `packages/shared`.

The normal agent snapshot contains page metadata, selected text, a limited body-text extraction, headings, at most 200 interactive elements near the viewport, a Page Agent-inspired simplified DOM, and page/scroll geometry. Performance evidence is an optional capability: Navigation and Resource Timing are attached only when the task explicitly asks about performance, network, requests, or APIs. Repository analysis reads the same evidence through a separate on-demand message. Ordinary action and verification snapshots never repeat Resource Timing collection. DOM nodes remain inside the content script and are represented externally by ephemeral refs. Candidate elements are bounded to a 700-pixel expansion around the viewport and checked against the browser's top-layer hit target before inclusion.

The side panel can attach one inspected element, page image, or captured viewport to the next message. The Responses provider sends the selected visual as an image input. Local Codex receives the selected element or screenshot metadata, but screenshot data URLs are removed from its text prompt. A successful initial agent response consumes the pending context and clears it from the composer. The user message keeps a compact, read-only attachment summary across side-panel reloads, while later agent-history requests omit the summary and all screenshot binary data.

### Conversation and tab lifecycle

A browser window owns one current conversation. Its session is stored under a window-scoped key and binds to the HTTP(S) tab that was active when the conversation was created. Browser focus and agent routing are separate:

- changing the browser's active tab only updates the side panel's viewing indicator;
- questions, Skills, repository analysis, recording, and DOM actions continue to use the conversation target;
- the page summary activates the bound tab but never rebinds the conversation;
- **New** discards the current conversation, creates a new id, and binds the currently viewed tab;
- selection and screenshot commands activate the target because they depend on a visible page;
- navigation inside the target tab remains in the same conversation;
- closing the target stops an active run and requires **New**; it never falls back to another open tab;
- agent events and returned results are accepted only when `windowId`, `conversationId`, and `targetTabId` all match;
- **New** remains disabled while a run is active; stopping keeps the UI busy until cancellation has reached the running provider;
- a `needs_user` decision persists the original task and combines the next user reply with it instead of starting an unrelated task.

Every planned run persists its `windowId`, `conversationId`, `tabId`, initial page URL, and snapshot id. The confirmed observe-act-verify loop reuses that immutable scope for every action, navigation recovery, observation, and verification step. It never falls back to the currently active browser tab. Pending selected-element context is keyed by target tab so another window cannot overwrite it.

### Local bridge

The bridge listens only on `127.0.0.1`. It:

1. accepts a page snapshot and user task;
2. selects applicable `SKILL.md` workflows;
3. routes the request to authenticated local Codex or the configured Responses API;
4. reuses provider conversation state until the user starts a new conversation, which clears both Codex thread and Responses chaining state;
5. parses and validates the JSON decision;
6. returns an answer, confirmation-required action plan, evidence-backed completion, blocked state, or request for user input.

After the initial plan is confirmed, the extension owns the V2 runtime loop. It executes one constrained action, waits for the page effect with an action-specific settle budget, captures a fresh structural snapshot, computes a fingerprint-based diff, verifies the expected state, and sends the observation back to the provider. Each continuation request carries that fresh snapshot once; loop metadata contains only the action, verification, and remaining budget instead of duplicating the page payload. Direct state actions such as fill and focus use a short wait; select, scroll, click, and submit retain progressively longer bounds for asynchronous page effects. The loop stops only on evidence-backed completion, a blocked/needs-user decision, two consecutive execution failures, eight actions, or 90 seconds. A navigation dispatch triggers re-observation and is not itself success.

Observe and plan remain internal runtime phases. They are not rendered as synthetic timeline entries because they add no user-visible evidence. Structured provider output is also kept internal: partial JSON tokens are protocol data, not useful progress. The timeline contains only real action, verification, completion, and error events. The initial action plan is shown once in the approval card rather than duplicated as an assistant message. Final assistant messages contain the user-facing result only; internal action counts remain in the status/timeline UI.

Completion evidence is validated against the latest snapshot. Every evidence item must be exact text or a URL present in that snapshot; a non-empty but invented explanation cannot close the loop. Click, submit, and scroll actions also require an observable page effect before verification succeeds.

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
{"kind":"needs_user","question":"Which account should be selected?"}
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

The content script records supported user interactions as declarative steps: action, sanitized selector, page URL, accessible label, scroll position, and an optional non-sensitive session value. The background worker owns recorder state so a same-tab navigation can re-arm recording. A test replay is explicit and confirmation-gated.

When saved, the bridge validates every URL and action, bounds the workflow to 100 steps, removes all recorded values, and replaces non-sensitive form values with named `{{variables}}`. Each generated folder contains instructions in `SKILL.md` and machine-readable configuration in `workflow.json`; both are loaded into the Codex planning context. Selectors are hints, not trusted commands, and current targets must be revalidated before execution.

The Skill discovery endpoint classifies hand-written Skills without workflow metadata as global. Recorded Skills match only pages with the same HTTP(S) origin and the recorded start-path prefix. Page-scoped Skills sort before global capabilities in the side panel, and unrelated page workflows are excluded from the Codex prompt as well as the visible function list.

Workflow schema v2 adds persistent `enabled` and `pagePatterns` fields. Pattern configuration rejects wildcard origins, credentials, queries, fragments, unsupported characters, and lists over 20 entries. Disabled workflows may be returned for management on a matching page, but the agent selector always filters them out.

## Deferred translation analysis

i18n is intentionally outside the current implementation. The shared protocol, element metadata collector, and repository query builder contain `TODO(i18n)` markers for a later `data-i18n-key` and translation-catalog provider without coupling that work to the current source/API flow.

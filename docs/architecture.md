# Architecture

## Product boundary

Auto Page Agent connects four evidence domains:

```text
browser page <-> network activity <-> source repository
```

The MVP implements the browser-page domain, lightweight performance evidence, local repository evidence search, a local agent bridge, and reusable skills. Translation-catalog analysis is deferred but marked with `TODO(i18n)` extension points.

## Runtime components

### Chrome extension

- **Side Panel** presents prompts, answers, plans, and approval controls.
- **Background service worker** owns the localhost connection and routes messages to the active tab.
- **Content script** creates a bounded snapshot and executes approved actions.
- **Element picker** captures source metadata and stable textual/attribute clues for repository analysis.
- **Screenshot capture** uses `captureVisibleTab` and keeps the JPEG data URL inside the extension side panel.
- **Workflow recorder** captures bounded declarative actions in Chrome session storage and never records sensitive values.

The snapshot contains page metadata, selected text, a limited body-text extraction, headings, at most 160 interactive elements near the viewport, a Page Agent-inspired simplified DOM, page/scroll geometry, and at most 100 resource timing entries. DOM nodes remain inside the content script and are represented externally by ephemeral refs. Candidate elements are bounded to a 700-pixel expansion around the viewport and checked against the browser's top-layer hit target before inclusion.

The side panel can attach one inspected element or image to the current conversation. A selected image remains local metadata for the local Codex prompt; the Responses provider can additionally send a public HTTP(S) or `data:image` source as an image input. Normal screenshots remain local previews and are not uploaded automatically.

### Local bridge

The bridge listens only on `127.0.0.1`. It:

1. accepts a page snapshot and user task;
2. selects applicable `SKILL.md` workflows;
3. routes the request to authenticated local Codex or the configured Responses API;
4. reuses provider conversation state and sends a constrained planning prompt;
5. parses and validates the JSON decision;
6. returns an answer or confirmation-required action plan.

After the initial plan is confirmed, the extension owns the V2 runtime loop. It executes one constrained action, waits for the DOM to settle, captures a fresh snapshot, computes a fingerprint-based diff, verifies the expected state, and sends the observation back to the provider. The loop stops on completion, two consecutive verification failures, eight actions, or 90 seconds. Provider deltas and runtime lifecycle events share the `AgentEvent` protocol and are rendered by the side-panel timeline.

### Agent provider router

`AgentRouter` supports `auto`, `codex`, and `openai` modes. `auto` prefers an authenticated local Codex app-server and falls back to the Responses API only when `OPENAI_API_KEY` is configured. Provider secrets stay in the bridge process and are never sent to the extension or page.

### Codex app-server adapter

The bridge discovers the Codex executable, launches `codex app-server --listen stdio://`, initializes it, checks `account/read`, sends JSON-RPC requests, and consumes newline-delimited notifications. Provider API-key environment variables are removed from the spawned process; primary agent authentication uses the user's existing ChatGPT/Codex OAuth login. API-key Codex sessions are not used for main agent prompts, matching Chromex's boundary. A bridge-process conversation id maps to a reusable Codex thread.

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

Invariant rules:

- refs must exist in the supplied snapshot;
- refs expire whenever a new snapshot is generated;
- no model-generated selector, XPath, or JavaScript is accepted;
- a plan contains at most four actions;
- values are length-limited;
- all MVP plans require explicit confirmation.

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

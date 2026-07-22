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

The snapshot contains page metadata, selected text, a limited body-text extraction, headings, at most 250 visible interactive elements, and at most 100 resource timing entries. DOM nodes remain inside the content script and are represented externally by ephemeral refs.

### Local bridge

The bridge listens only on `127.0.0.1`. It:

1. accepts a page snapshot and user task;
2. selects applicable `SKILL.md` workflows;
3. opens an ephemeral Codex thread;
4. sends a constrained planning prompt;
5. parses and validates the JSON decision;
6. returns an answer or confirmation-required action plan.

### Codex app-server adapter

The bridge discovers the Codex executable, launches `codex app-server --listen stdio://`, initializes it, checks `account/read`, sends JSON-RPC requests, and consumes newline-delimited notifications. Provider API-key environment variables are removed from the spawned process; primary agent authentication uses the user's existing ChatGPT/Codex OAuth login. API-key Codex sessions are not used for main agent prompts, matching Chromex's boundary.

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

## Future provider interface

Both local and remote runtimes should implement:

```ts
interface AgentProvider {
  readonly name: string;
  run(task: string, snapshot: PageSnapshot): Promise<AgentDecision>;
}
```

Planned implementations:

- `CodexProvider`: local Codex app-server and local skills/MCP.
- `OpenAIResponsesProvider`: company backend using Responses API function tools.
- `CompanyAgentProvider`: authenticated remote repository and internal platform access.

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

## Deferred translation analysis

i18n is intentionally outside the current implementation. The shared protocol, element metadata collector, and repository query builder contain `TODO(i18n)` markers for a later `data-i18n-key` and translation-catalog provider without coupling that work to the current source/API flow.

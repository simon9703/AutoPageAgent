# Architecture

## Product boundary

Auto Page Agent connects four evidence domains:

```text
browser page <-> network activity <-> source repository <-> translation catalog
```

The MVP implements the browser-page domain, lightweight performance evidence, a local agent bridge, and reusable skills. The interfaces are intentionally small so local Codex can later coexist with a remote company Agent Server.

## Runtime components

### Chrome extension

- **Side Panel** presents prompts, answers, plans, and approval controls.
- **Background service worker** owns the localhost connection and routes messages to the active tab.
- **Content script** creates a bounded snapshot and executes approved actions.

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

The bridge launches `codex app-server --listen stdio://`, initializes it, sends JSON-RPC requests, and consumes newline-delimited notifications. Provider API-key environment variables are removed from the spawned process; authentication should use the user's existing Codex login.

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

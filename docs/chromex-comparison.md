# Chromex comparison: API and local Codex

This document separates three different meanings of “API” that are easy to mix together.

## 1. Local Codex app-server

Both projects use the same fundamental boundary:

```text
Chrome extension -> local bridge -> codex app-server -> thread/start + turn/start
```

Chromex uses Chrome Native Messaging between the extension and its local bridge. Auto Page Agent currently uses a loopback WebSocket for easier development; Native Messaging remains the production target.

| Capability | Chromex | Auto Page Agent v0.7 |
| --- | --- | --- |
| Start `codex app-server` | Yes | Yes |
| JSON-RPC over stdio | Yes | Yes |
| `initialize` / `initialized` | Yes | Yes |
| `thread/start` / `turn/start` | Yes | Yes |
| Account status with `account/read` | Yes | Yes |
| Executable discovery / override | Yes | Yes |
| App-server overload retry | Yes | Yes |
| Delta streaming | Yes | Not yet |
| Thread continuity | Yes | Yes, in-process conversation map |
| Model catalog | Yes | Not yet |
| App-server server-request handlers | Full policy handlers | Explicit unsupported response |
| Skills from Codex `skills/list` | Yes | Local `SKILL.md` loader only |
| MCP/apps/plugins | Yes | Not yet |

Reference implementations:

- [Chromex codex-app-server client](https://github.com/GENEXIS-AI/chromex/blob/main/packages/bridge/src/codex-app-server.ts)
- [Chromex Codex plane](https://github.com/GENEXIS-AI/chromex/blob/main/packages/bridge/src/codex-plane.ts)

## 2. OpenAI API key

Chromex does **not** run its primary browser-agent/Codex chat requests through API-key authentication. Its Codex plane explicitly rejects a Codex `apiKey` account for main prompt requests and asks the user to use ChatGPT-managed authentication. The separately entered OpenAI API key is stored locally for dedicated features such as realtime translation.

Auto Page Agent keeps that Chromex-compatible local Codex boundary:

- provider API-key environment variables are removed before spawning Codex;
- `account/read` verifies the current Codex account;
- ChatGPT/Codex OAuth login is supported through the existing local CLI state;
- an API-key Codex session is reported as unsupported for the main browser agent;
- the extension never stores an OpenAI API key.

At the user's request, v0.7 also adds a **separate** Responses API provider. This does not authenticate `codex app-server` with an API key. The extension talks only to the local bridge; the bridge reads `OPENAI_API_KEY` from its environment and calls the Responses API directly. `AUTO_PAGE_AGENT_PROVIDER=auto|codex|openai` controls routing.

Both providers share the same compact page context and constrained decision validator. Local Codex reuses an app-server thread per conversation. Responses API mode reuses `previous_response_id` per conversation and resends bounded history only when starting a new API conversation.

## 3. APIs used by the current webpage

This is independent of OpenAI authentication.

Auto Page Agent v0.3 extracts `fetch` and `xmlhttprequest` URLs from Resource Timing, strips query strings, and adds bounded endpoint paths to local repository evidence search. This can locate literals such as:

```text
/api/v2/withdrawal/detail
```

Current limitations:

- Resource Timing does not expose request or response bodies.
- Status codes and request methods are unavailable.
- The endpoint is page-level evidence; it is not yet proven to belong to the selected element.
- Dynamic URLs may need source-symbol tracing rather than exact string search.

The next reliable step is component -> hook -> API client -> response type tracing. An opt-in `chrome.debugger` collector can be added later for method, status, initiator, headers, and failure reason.

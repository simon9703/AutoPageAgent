# Security model

## MVP guarantees

- The bridge binds to loopback only.
- WebSocket connections with a non-extension origin are rejected.
- API keys are not stored in extension storage.
- API-key environment variables are stripped before Codex is spawned.
- The model cannot submit JavaScript, XPath, or new selectors.
- Only visible snapshot refs can be acted on.
- Refs are scoped to one snapshot version.
- Every MVP action plan requires confirmation.
- Payment, credential, destructive, and hidden-element operations are outside the tool set.

## Known development limitation

Origin validation alone is not a complete authentication mechanism for a distributable localhost service. Before packaging, add one of:

1. Chrome Native Messaging with an extension-ID allowlist; or
2. a randomly generated install-time bridge secret stored using OS-appropriate permissions and sent during the WebSocket handshake.

Native Messaging is preferred for a public production release.

## Remote company deployment

The remote Agent Server must enforce:

- short-lived authenticated user sessions;
- repository and branch authorization on every tool call;
- domain and page allowlists;
- server-side translation-platform authorization;
- tool scopes declared by each Skill;
- confirmation for publish, send, approve, delete, and release actions;
- secret and personal-data redaction in logs;
- revision IDs attached to all source conclusions;
- auditable actor, tool, target, result, and timestamp records.

The browser extension must never receive Git provider, translation-platform, or OpenAI service credentials used by the company server.

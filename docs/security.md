# Security model

## MVP guarantees

- The bridge exposes no TCP listener.
- Chrome Native Messaging launches the installed bridge only for the extension id in `allowed_origins`.
- API keys are not stored in extension storage.
- Responses API keys are read only from the local bridge process environment and sent only to `api.openai.com`.
- API-key environment variables are stripped before Codex is spawned.
- The model cannot submit JavaScript, XPath, or new selectors.
- Only visible snapshot refs can be acted on.
- The model receives a compact indexed DOM without CSS selectors; selectors and live DOM references remain in the content script.
- Refs are scoped to one snapshot version.
- Every single-plan MVP action requires confirmation. V2 requires explicit consent before starting the clearly labeled bounded loop; subsequent safe steps are visible in real time, individually validated, and stop at the configured step/time/failure budgets.
- Payment, credential, destructive, and hidden-element operations are outside the tool set.
- Password, file, token-like, OTP, and payment-like fields are marked sensitive; their values are excluded and agent filling is rejected.
- User-authorized test flows are not rejected from page keywords alone. Labels such as amount, order, checkout, payment, or exam may be handled through ordinary constrained actions when the environment has no real-world effect; sensitive-field rejection, the initial confirmation, fresh-snapshot refs, budgets, and verification remain unchanged.
- Repository queries run through direct `rg` process arguments with fixed strings, limits, timeouts, and no shell interpolation.

## Local installation boundary

The one-time installer writes a user-scoped native-host manifest and copies built runtime assets into the user's application-support directory. Re-running the installer replaces that installed runtime. The fixed manifest key gives unpacked builds a stable extension id, and the native-host manifest allowlists only that id. A store release must replace or extend the allowlist with its final store id.

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

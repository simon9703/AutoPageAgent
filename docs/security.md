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
- Popup close is executor-owned housekeeping and is absent from the Provider action schema. It accepts only a Background-generated request bound to the latest snapshot ref and trusted fingerprint for an expanded combobox or controlled listbox/menu; dialog is never a housekeeping target.
- The content script may first send a synthetic Escape, then asks Background to briefly attach Chrome Debugger Protocol and dispatch one extension-fixed trusted `rawKeyDown(Escape) -> keyUp(Escape)` sequence. Each keyboard attempt is followed by a fresh semantic Snapshot. If the popup remains open, Content Script computes one non-interactive point outside the popup and requests one bounded trusted `mouseMoved -> mousePressed -> mouseReleased` click.
- Modal dropdown safe-point search remains inside dialog content, outside the popup, and rejects backdrop, interactive ancestors, interactive descendants, and proxy wrappers. Failure after trusted Escape and the single safe click stops immediately.
- Housekeeping is skipped while the next queued target is an unselected option in the same owner/layer. It runs before moving outside the popup and does not consume the Provider action budget.
- Dialog close/cancel uses only an explicit Close/Cancel control exposed in the latest Snapshot as an ordinary `click`. Automatic dialog dismiss, task-text authorization regexes, backdrop invention, and model-provided coordinates are not supported.
- The `debugger` permission is used only for the fixed trusted Escape and bounded trusted exterior click. Requests are rejected unless they originate from the active Agent run's top-frame content script and target the same tab. Each request detaches immediately after dispatch; no general key, CDP method, selector, or coordinate action is exposed through the Agent protocol.
- `observe` is a decision, not a browser action. Bridge and Background cap it at 30 seconds per request; Background compares bounded semantic signatures, waits for a stable non-busy change, and still enforces the global 30-minute task budget.
- Pagination and container scrolling remain ordinary constrained actions. Pagination cannot queue multiple Next/Previous clicks, disabled controls cannot execute, and a scroll container requires a Bridge-bound fingerprint plus a fresh target ref.
- Newly added alert/dialog/status nodes prove a click or submit effect only when they contain a non-empty accessible label, text, value, or display/selected value. Empty offscreen alert/status nodes are treated as route-transition signals, so execution waits for bounded destination-page evidence and fails verification if it never appears.
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

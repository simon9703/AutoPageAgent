# AGENTS.md

## Project summary

Auto Page Agent is a local-first Chrome MV3 side-panel agent. It observes the conversation's explicitly selected target page, asks either local Codex or the OpenAI Responses API for a constrained decision, and executes only explicit, reviewable browser actions. The current implementation includes the V2 observe-plan-act-verify runtime and the V3 local Skill Marketplace/Registry.

The product is intentionally split into three trust zones:

1. `packages/extension` owns browser state, snapshots, approval UI, and DOM execution.
2. `packages/bridge` owns provider access, agent prompting, repository search, Skill selection, and durable local Skill storage.
3. `packages/shared` owns every message, snapshot, action, Skill, and event type shared across those processes.

Read `README.md` for usage, `docs/architecture.md` for component boundaries, `docs/security.md` for invariants, and `docs/roadmap.md` before expanding scope.

## Repository map

- `packages/shared/src/index.ts`: compatibility barrel for cross-process domain and protocol types.
- `packages/shared/src/{agent,browser,chat,repositories,skills}.ts`: bounded shared domain models.
- `packages/shared/src/protocol.ts`: Native Messaging request/response unions.
- `packages/shared/src/agent-events.ts`: streaming/runtime timeline event protocol.
- `packages/bridge/src/index.ts`: minimal Native Messaging stdin/stdout host.
- `packages/bridge/src/bridge/message-router.ts`: validated request dispatch, active-run cancellation, and response routing.
- `packages/bridge/src/native-messaging.ts`: Chrome native-message framing.
- `packages/bridge/src/agent.ts`: stable Agent API barrel.
- `packages/bridge/src/agent/`: provider router, provider implementations, prompts, Responses streaming, and decision validation.
- `packages/bridge/src/codex-app-server.ts`: Codex app-server JSON-RPC adapter.
- `packages/bridge/src/skills.ts`: stable Skill API plus Registry/Marketplace persistence.
- `packages/bridge/src/logs.ts`: bounded durable conversation and operation-history persistence.
- `packages/bridge/src/data-paths.ts`: shared durable user-data root for sibling `skills/` and `logs/` directories.
- `packages/bridge/src/skills/`: Skill models, page matching, selection, workflow generation, and pure validation helpers.
- `packages/bridge/src/repositories.ts`: bounded local `rg` evidence search.
- `packages/extension/src/background.ts`: service-worker entry, Chrome event listeners, message dispatch, and agent-loop orchestration.
- `packages/extension/src/background/`: bridge transport, target-tab messaging, screenshots, recorder state, and pending-run persistence.
- `packages/extension/src/content.ts`: minimal content-script bootstrap.
- `packages/extension/src/content/runtime.ts`: page message routing, snapshots, constrained actions, and verification.
- `packages/extension/src/content/`: DOM helpers, recording, selection, and isolated agent visual lifecycle.
- `packages/extension/src/sidepanel.tsx`: minimal React mount entry.
- `packages/extension/src/sidepanel/App.tsx`: stable side-panel component entry.
- `packages/extension/src/sidepanel/controller.tsx`: Chrome state, persistence, and conversation workflow orchestration.
- `packages/extension/src/sidepanel/components.tsx`: side-panel presentation components.
- `packages/extension/src/sidepanel/i18n/`: side-panel locale initialization and translation resources.
- `skills/*`: bundled Marketplace templates. These are distribution assets, not user data.
- `packages/bridge/test`: Node test suite for agent, runtime, repository, and Skill behavior.
- `docs/github/page-agent-analysis.md`: source-backed Page Agent architecture, DOM-agent, navigation, action, and integration analysis.
- `docs/github/chromex-analysis.md`: source-backed Chromex side-panel, Codex app-server, read-routing, screenshot, and action analysis.
- `docs/github/ego-lite-analysis.md`: source-backed Ego Lite semantic/visual/CDP browser-control, readiness, and learned-tool analysis.

## Reference implementation analyses

The comparison documents under `docs/github/` are maintained engineering references, not one-time summaries.

- Before changing page snapshots, visual recovery, navigation/readiness, browser actions, provider image inputs, site adapters, or browser-control ownership, read the relevant Page Agent, Chromex, or Ego Lite analysis first.
- Treat the reference checkout source as authoritative. Each analysis header records the exact reviewed commit; when a reference checkout changes, update both that commit and the affected findings.
- Keep three categories explicit in future additions: source-confirmed behavior, engineering inference, and proposed Auto Page Agent adaptation.
- Add new source-specific discoveries to the matching analysis instead of scattering notes. Cross-project conclusions may also be reflected in architecture or roadmap documents, but implementation details remain under `docs/github/`.
- Preserve Auto Page Agent's safety boundaries. Page Agent's optional JavaScript execution, Chromex's product routing and selectors, and Ego Lite's raw CDP or coordinate controls are references, not authorization to weaken constrained actions.
- Treat `../refs/page-agent`, `../refs/chromex`, and `../refs/ego-lite` as read-only comparison checkouts.

## Commands

Use Node.js 20+ and npm workspaces from the repository root.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run bridge
```

Run all three validation commands before committing. `typecheck` builds `@auto-page-agent/shared` first because the other workspaces consume its generated declarations. Load `packages/extension/dist` as an unpacked extension only after `npm run build`.

## Non-negotiable safety invariants

- Never add arbitrary JavaScript, `eval`, model-generated selectors, XPath, or shell execution as browser tools.
- The model may act only through `BrowserActionKind` and refs from the latest `PageSnapshot`.
- Snapshot refs are ephemeral. After every action, navigation, or meaningful DOM change, capture a new snapshot and do not reuse old refs.
- Keep approval and bounded-loop controls intact. The current loop stops after 8 actions, 90 seconds, or 2 consecutive verification failures.
- Reject hidden, occluded, disabled, stale, and sensitive targets as appropriate. Keep readonly controls observable and clickable when safe, but reject `fill` and `select` on them. Never persist password, token, OTP, payment, credential, or file-input values.
- Keep provider secrets in the bridge process. Never send API keys to extension storage, the content script, or the webpage.
- Keep the bridge bound to loopback and retain extension-origin checks.
- Run repository searches with direct argument arrays, fixed-string matching, bounds, and timeouts. Never interpolate page/model text into a shell command.
- Installing or running a Skill must not grant new browser permissions or bypass confirmation, action validation, budgets, or verification.

If a requested feature conflicts with these rules, preserve the boundary and document the limitation instead of weakening it.

## Agent-loop rules

- Preserve the internal flow `Observe -> multi-step Plan -> confirm once -> Act one step -> settle -> Observe -> Verify -> rebind the next queued target -> continue/replan/stop`.
- Plan only actions whose targets exist in the current snapshot. The bridge must attach trusted target fingerprints after ref validation; providers never author fingerprints.
- Execute a verified queue locally. Ask the provider again only when the queue ends, a target cannot be uniquely rebound, verification fails, navigation/context replacement occurs, or the page branches.
- A continuation turn receives the fresh snapshot, snapshot diff, prior action result, failure count, and remaining budget.
- Send the fresh snapshot only once per continuation request; do not duplicate it inside loop metadata.
- Do not expose static Observe/Plan labels or partial provider JSON as progress. Emit only real action/verification updates, completion, and errors through the shared `AgentEvent` protocol.
- Scope every UI agent event and returned result to `windowId + conversationId + targetTabId`. A stopped or different conversation must not mutate the current timeline or append a late assistant result.
- Keep one current conversation per browser window. An empty conversation follows the active tab; the first user message locks its target. Later tab focus changes never rebind a started conversation, target navigation stays in the conversation, and a closed target requires **New**.
- Keep initial plans in the approval card, runtime step counts in status/timeline UI, and user-facing answers in chat. Do not duplicate plan or execution metadata as assistant messages.
- Treat selected-element and screenshot attachments as one-message model context after a successful initial agent response. Retain only a compact, read-only attachment summary on the user message; never resend that summary or screenshot binary in later agent history.
- Preserve `needs_user` continuation: a typed reply or confirmed preselected choice must resume the pending original task, including after the side panel reloads.
- Keep `answer`, `complete`, `blocked`, and `needs_user` semantically separate. After the first browser action, only evidence-backed `complete` may end the run successfully.
- When a completion claim lacks current-snapshot evidence, allow one bounded recovery turn to find or reveal exact evidence. If it still cannot be verified, report that the action may have been submitted but completion is unconfirmed.
- Navigation requires a fresh observation and never proves task completion by itself.
- Normalize and validate every provider response in the bridge even when structured output is enabled upstream.
- Keep Codex and Responses behavior aligned behind the provider abstraction. Provider-specific transport code must not leak into extension logic.
- Navigation may reload the content script; preserve background-owned loop/recorder recovery behavior.

## DOM snapshot and action rules

- Keep snapshots compact and bounded; do not send the full DOM or raw page HTML.
- Keep Performance and API request evidence on demand. Ordinary action/verification snapshots must not repeatedly collect or transmit Resource Timing.
- Prefer accessibility semantics, visible text, stable fingerprints, viewport geometry, and interaction state over CSS implementation detail.
- Selectors are content-script/recorder hints only. Do not expose them as trusted model-authored inputs.
- New action kinds require coordinated changes in shared types, bridge validation/prompting, content execution, verification, UI labels, security docs, and tests.
- Use `click` for buttons and button-like controls, including controls labeled Submit, Pay, Confirm, or Top Up. Reserve `submit` for a native form target.
- Every mutating action needs an explicit verification rule. A successful DOM method call alone is not proof of task success, and completion evidence must match exact text or a URL in the latest snapshot.
- Treat a target that disappeared or became unavailable before dispatch as a stale snapshot signal: reobserve and replan without counting a verification failure.
- Use action-specific settle budgets. Direct state updates should not inherit the longest click/submit wait.

## Skill rules

- Bundled templates live in repository `skills/`; installed and custom user Skills live under `${AUTO_PAGE_AGENT_DATA_DIR:-~/.auto-page-agent}/skills`.
- Never write user edits back into bundled templates. Repository or extension upgrades must not replace user Skills.
- Preserve explicit create-versus-update behavior. Duplicate names must not silently overwrite; updates must increment the patch version.
- Keep imported/exported Skill bundles declarative and validated. Imports must not overwrite an existing slug, and deleting an installed Marketplace template must not delete the bundled source.
- Validate Skill slugs, HTTP(S) page patterns, workflow size, actions, variables, and recorded values at the bridge boundary.
- Page-scoped and enabled Skills rank ahead of global Skills. Keep match reasons visible and keep selected Skill context across loop turns.
- Marketplace updates may replace the installed template copy only after explicit user confirmation.
- A generated workflow remains declarative (`SKILL.md` plus `workflow.json`) and uses the same constrained agent loop as manual tasks.
- Recorder screenshots are bounded session-only context. Never write screenshot data URLs into `SKILL.md`, `workflow.json`, exports, or Agent conversation history.

## Conversation log rules

- Durable conversation logs live under `${AUTO_PAGE_AGENT_DATA_DIR:-~/.auto-page-agent}/logs`, beside user Skills.
- Persist compact messages, target-page metadata, continuation state, and Action/Verify/Complete/Error events only.
- Never persist screenshot data URLs, recorded form values, ephemeral DOM refs, provider protocol fragments, or full snapshots in logs.
- Keep log writes revisioned so stale asynchronous writes cannot replace newer conversation state.
- Restoring history may reuse its original bound tab only while that tab still exists. Never silently rebind a saved conversation to the active browser tab.

## Change workflow

1. Inspect `git status`, the relevant types, and the nearest tests before editing.
2. Make the smallest coherent change in the owning package; avoid duplicating protocol types between packages.
3. Update `packages/shared` first for cross-boundary changes, then bridge, extension, tests, and relevant docs.
4. Add regression tests for validation, parsing, selection, persistence, retry, or security-boundary changes. For content-script UI/DOM changes without a browser harness, keep logic small and verify with typecheck/build plus a manual mock-mode flow when practical.
5. Every completed change must include a version bump before it is committed, including fixes, features, refactors, documentation, and configuration changes. Use SemVer: increment patch by default, minor for backward-compatible feature releases, and major for breaking changes.
6. Keep the version synchronized in the root `package.json`, every workspace `package.json`, `packages/extension/manifest.json`, internal workspace dependency versions, and `package-lock.json`. Never leave mixed project versions in one commit.
7. Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.
8. Review the final diff for secrets, accidental generated files, unrelated user changes, and inconsistent versions before commit or push.

Do not commit `node_modules`, workspace-local configuration, API keys, generated screenshots, or user Registry data. Do not rewrite or discard unrelated working-tree changes.

## Coding conventions

- Use TypeScript ESM and include `.js` in relative import specifiers, matching the existing source.
- Keep strict typing; prefer narrow unions, type guards, and boundary validation over casts.
- Keep shared messages backward-compatible when practical. New request/response variants must use explicit discriminants.
- Prefer small pure helpers for parsing, normalization, matching, diffing, and verification so they are testable without Chrome.
- Keep user-visible errors actionable but redact secrets and sensitive field values.
- Preserve the current dependency-light design. Add a dependency only when it materially improves correctness or maintainability.

## Extension UI conventions

- Use `lucide-react` for interface icons. Import individual icons and keep sizes aligned with the surrounding control.
- Prefer shared controls from `packages/extension/src/components/ui/`, starting with `Button`, instead of duplicating button class strings in new UI.
- Compose conditional Tailwind classes with `packages/extension/src/lib/utils.ts` (`cn`) so conflicting utilities are merged predictably.
- Use black backgrounds with white text for primary actions; use outline or ghost variants for secondary actions.
- Icon-only buttons must have an accessible label and title. Prefer a short text label for important actions such as starting a new conversation.

## Definition of done

A change is complete when the owning package and all affected boundaries agree, unsafe inputs fail closed, relevant documentation reflects the behavior, the project version has been incremented consistently, the full validation suite passes, and the worktree contains only intentional files.

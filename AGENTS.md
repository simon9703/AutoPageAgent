# AGENTS.md

## Project summary

Auto Page Agent is a local-first Chrome MV3 side-panel agent. It observes the conversation's explicitly selected target page, asks either local Codex or the OpenAI Responses API for a constrained decision, and executes only explicit, reviewable browser actions. The current implementation includes the V2 observe-plan-act-verify runtime and the V3 local Skill Marketplace/Registry.

The product is intentionally split into three trust zones:

1. `packages/extension` owns browser state, snapshots, approval UI, and DOM execution.
2. `packages/bridge` owns provider access, agent prompting, repository search, Skill selection, and durable local Skill storage.
3. `packages/shared` owns every message, snapshot, action, Skill, and event type shared across those processes.

Read `README.md` for usage, `docs/architecture.md` for component boundaries, `docs/security.md` for invariants, and `docs/roadmap.md` before expanding scope.

## Repository map

- `packages/shared/src/index.ts`: cross-process protocol and domain types.
- `packages/shared/src/agent-events.ts`: streaming/runtime timeline event protocol.
- `packages/bridge/src/index.ts`: loopback WebSocket server and request routing.
- `packages/bridge/src/agent.ts`: Codex/Responses providers, prompts, streaming, and decision validation.
- `packages/bridge/src/codex-app-server.ts`: Codex app-server JSON-RPC adapter.
- `packages/bridge/src/skills.ts`: Marketplace, local Registry, page matching, selection, migration, and persistence.
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
- `skills/*`: bundled Marketplace templates. These are distribution assets, not user data.
- `packages/bridge/test`: Node test suite for agent, runtime, repository, and Skill behavior.

## Commands

Use Node.js 20+ and npm workspaces from the repository root.

```bash
npm install
npm run typecheck
npm test
npm run build
AUTO_PAGE_AGENT_MOCK=1 npm run dev:bridge
```

Run all three validation commands before committing. `typecheck` builds `@auto-page-agent/shared` first because the other workspaces consume its generated declarations. Load `packages/extension/dist` as an unpacked extension only after `npm run build`.

## Non-negotiable safety invariants

- Never add arbitrary JavaScript, `eval`, model-generated selectors, XPath, or shell execution as browser tools.
- The model may act only through `BrowserActionKind` and refs from the latest `PageSnapshot`.
- Snapshot refs are ephemeral. After every action, navigation, or meaningful DOM change, capture a new snapshot and do not reuse old refs.
- Keep approval and bounded-loop controls intact. The current loop stops after 8 actions, 90 seconds, or 2 consecutive verification failures.
- Reject hidden, occluded, disabled, readonly, stale, and sensitive targets as appropriate. Never persist password, token, OTP, payment, credential, or file-input values.
- Keep provider secrets in the bridge process. Never send API keys to extension storage, the content script, or the webpage.
- Keep the bridge bound to loopback and retain extension-origin checks.
- Run repository searches with direct argument arrays, fixed-string matching, bounds, and timeouts. Never interpolate page/model text into a shell command.
- Installing or running a Skill must not grant new browser permissions or bypass confirmation, action validation, budgets, or verification.

If a requested feature conflicts with these rules, preserve the boundary and document the limitation instead of weakening it.

## Agent-loop rules

- Preserve the internal flow `Observe -> Plan -> confirm -> Act one step -> settle -> Observe -> Verify -> continue/stop`.
- A continuation turn receives the fresh snapshot, snapshot diff, prior action result, failure count, and remaining budget.
- Send the fresh snapshot only once per continuation request; do not duplicate it inside loop metadata.
- Do not expose static Observe/Plan labels or partial provider JSON as progress. Emit only real action/verification updates, completion, and errors through the shared `AgentEvent` protocol.
- Scope every UI agent event and returned result to `windowId + conversationId + targetTabId`. A stopped or different conversation must not mutate the current timeline or append a late assistant result.
- Keep one current conversation per browser window. **New** binds the active tab in that window; tab focus changes never rebind it, target navigation stays in the conversation, and a closed target requires **New**.
- Keep initial plans in the approval card, runtime step counts in status/timeline UI, and user-facing answers in chat. Do not duplicate plan or execution metadata as assistant messages.
- Treat selected-element and screenshot attachments as one-message model context after a successful initial agent response. Retain only a compact, read-only attachment summary on the user message; never resend that summary or screenshot binary in later agent history.
- Preserve `needs_user` continuation: the next user reply must resume the pending original task, including after the side panel reloads.
- Keep `answer`, `complete`, `blocked`, and `needs_user` semantically separate. After the first browser action, only evidence-backed `complete` may end the run successfully.
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
- Every mutating action needs an explicit verification rule. A successful DOM method call alone is not proof of task success, and completion evidence must match exact text or a URL in the latest snapshot.
- Use action-specific settle budgets. Direct state updates should not inherit the longest click/submit wait.

## Skill rules

- Bundled templates live in repository `skills/`; installed and custom user Skills live under `${AUTO_PAGE_AGENT_DATA_DIR:-~/.auto-page-agent}/skills`.
- Never write user edits back into bundled templates. Repository or extension upgrades must not replace user Skills.
- Preserve explicit create-versus-update behavior. Duplicate names must not silently overwrite; updates must increment the patch version.
- Validate Skill slugs, HTTP(S) page patterns, workflow size, actions, variables, and recorded values at the bridge boundary.
- Page-scoped and enabled Skills rank ahead of global Skills. Keep match reasons visible and keep selected Skill context across loop turns.
- Marketplace updates may replace the installed template copy only after explicit user confirmation.
- A generated workflow remains declarative (`SKILL.md` plus `workflow.json`) and uses the same constrained agent loop as manual tasks.

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

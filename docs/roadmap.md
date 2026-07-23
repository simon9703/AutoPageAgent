# Product Status and Roadmap

This document is the single checklist for shipped capabilities and future scope.
Checked items are implemented in the current repository. Unchecked items are
planned only and must not be described as available.

## Current release — 0.7.17

### Agent Runtime

- [x] Constrained `Observe → Plan → Confirm → Act → Verify` loop
- [x] Separate `answer`, `action_plan`, `complete`, `blocked`, and `needs_user` decisions
- [x] Refresh the page snapshot after every action or navigation
- [x] Validate completion evidence against exact text or a URL in the latest snapshot
- [x] Require observable effects for click, submit, and scroll verification
- [x] Bound each run to 8 actions, 90 seconds, and 2 consecutive verification failures
- [x] Re-plan after recoverable failures and re-observe after navigation
- [x] Use action-specific settle budgets instead of one fixed wait
- [x] Keep one global active Agent Run to prevent concurrent browser mutations

### Conversation and Tab Isolation

- [x] Keep one current conversation per browser window
- [x] Bind a new conversation to that window's active HTTP(S) tab
- [x] Keep the target fixed when the user views another tab
- [x] Treat navigation inside the bound tab as the same conversation
- [x] Scope events and results by `windowId + conversationId + targetTabId`
- [x] Ignore stopped, stale, late, or different-conversation events and results
- [x] Keep **New** unavailable until the active run has stopped
- [x] Stop safely when the bound tab closes and require **New** to continue
- [x] Persist `needs_user` and combine the next reply with the original task
- [x] Keep local Codex thread and Responses `previous_response_id` continuity

### Message Context and Attachments

- [x] Select page text, elements, public images, and visible-page captures
- [x] Use selected-element and screenshot context for one model request
- [x] Clear consumed context from the composer after a successful send
- [x] Retain a compact attachment summary on the original user message
- [x] Exclude attachment summaries and screenshot binary data from later model history
- [x] Isolate pending selected-element context by target tab
- [x] Send supported visual input through the Responses provider
- [ ] Send screenshot/binary image input to local Codex

### Page Understanding and Performance

- [x] Build a compact indexed DOM with visible interactive elements and viewport pruning
- [x] Capture page text, selected text, headings, geometry, and interaction state
- [x] Track stable fingerprints, occlusion, loading, disabled, read-only, checked, and expanded state
- [x] Compute snapshot diffs and element-state changes between actions
- [x] Collect Navigation and Resource Timing only for explicit performance/network/API tasks
- [x] Avoid duplicate Snapshot payloads in continuation requests
- [x] Correlate fetch/XHR Resource Timing URLs with bounded repository search

### Side-panel Experience

- [x] Chrome MV3 Side Panel with a fixed conversation composer
- [x] **New** starts a genuinely fresh provider conversation
- [x] Bound-page summary returns the user to the target tab without rebinding it
- [x] Stop control with real cancellation/busy state
- [x] Approval card for the initial action plan
- [x] Timeline containing real Action, Verify, Complete, and Error events only
- [x] Keep plan summaries out of chat and internal step counts out of assistant replies
- [x] AI pointer, target ring, and action-status label
- [x] Restore messages, attachment summaries, and pending follow-up state after side-panel reload
- [ ] Step-by-step execution replay

### Skill Marketplace and Local Registry

- [x] Current Page, My Skills, and Marketplace views
- [x] Daily report, release, translation, and page-assistant templates
- [x] Record and confirmation-gated replay on the current page
- [x] Generate declarative `SKILL.md` and parameterized `workflow.json`
- [x] Save new Skills without silently overwriting an existing Skill
- [x] Update an existing Skill with a patch-version increment
- [x] Install and explicitly update Marketplace templates
- [x] Store user Skills outside the repository under `~/.auto-page-agent/skills`
- [x] Preserve installed and custom Skills across repository/extension upgrades
- [x] Match by origin/path prefix and configurable path wildcards
- [x] Show page-scoped Skills and explicit match reasons
- [x] Run Skills through the same constrained Agent Runtime
- [x] Redact sensitive recorded values and use manual-input checkpoints
- [x] Enable or disable installed Skills

### Local Repository Intelligence

- [x] Configure one or more local repository roots
- [x] Run bounded fixed-string `rg` evidence searches
- [x] Classify source, symbol, text, and API evidence with confidence levels
- [x] Discover the Codex executable and read cached account status
- [x] Retry app-server overloads and return structured provider errors
- [ ] Add bounded `repo.read_file` and TypeScript-aware `repo.find_references`
- [ ] Read Git revision and current branch context
- [ ] Resolve TypeScript symbols through the language service
- [ ] Correlate DOM element → component → hook → API request

## Next priorities

These items extend the current local-first product without changing its safety
model or introducing a full multi-conversation system.

### P0 — Reliability and diagnostics

- [ ] Persist per-run duration, action count, verification failures, and final status
- [ ] Show failed-step diagnostics in Skill debug results
- [ ] Add browser integration tests for stop, target-tab close, navigation, and late-event races
- [ ] Add compact Snapshot/token-size diagnostics without sending them to the model
- [ ] Improve event-driven page settling for asynchronous DOM and network changes

### P1 — Skill authoring

- [ ] Edit, reorder, disable, and delete individual recorded steps
- [ ] Regenerate stale refs/selectors through a fresh page observation
- [ ] Add step-specific confirmation policies without bypassing the global safety boundary
- [ ] Declare required browser tools and permissions in Skill metadata
- [ ] Export and import a portable Skill bundle
- [ ] Show workflow success rate and failed-step metrics

### P1 — Source-to-page analysis

- [ ] Add `repo.read_file` with root, size, and line-count bounds
- [ ] Add TypeScript-aware symbol and reference lookup
- [ ] Correlate request URLs with API clients, hooks, and response types
- [ ] Support optional build metadata for component/source mapping
- [ ] Prove selected element → component → prop/hook → API relationship

### P2 — Registry and workflow expansion

- [ ] Match Skills with a DOM/page fingerprint
- [ ] Discover target tabs automatically by URL, title, and page fingerprint
- [ ] Support explicit, confirmation-gated cross-tab workflows
- [ ] Add a signed team Skill registry with versioned update channels
- [ ] Resolve customized Marketplace updates with conflict-aware three-way merging

## Explicitly deferred

These are not part of the current local MVP:

- [ ] Full conversation history, search, rename, pinning, or multi-conversation UI
- [ ] Multiple concurrent Agent Runs across tabs or windows
- [ ] Automatic conversation rebinding when browser focus changes
- [ ] Authenticated remote Agent Server
- [ ] GitHub, GitLab, or internal remote repository providers
- [ ] Repository mirrors and revision-aware remote indexes
- [ ] Private source-map/build-artifact providers
- [ ] Per-user remote tool authorization and audit infrastructure
- [ ] Translation/i18n intelligence beyond declarative workflow Skills

## Product invariants

- A model can act only through the constrained browser action protocol and refs
  from the latest Snapshot.
- Skills never grant permissions or bypass approval, budgets, validation, or
  verification.
- Performance/API evidence is on demand and is not part of ordinary Agent
  observations.
- **New** starts one fresh conversation bound to the active tab; the current
  release intentionally does not keep a user-facing conversation archive.

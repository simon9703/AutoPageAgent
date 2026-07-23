# Roadmap

## Version 0.3 — Skill Marketplace and Local Registry

Goal: turn recorded workflows and prompt instructions into durable, discoverable, editable browser capabilities.

### Skill Hub

- [x] Current page / My Skills / Marketplace views
- [x] Daily report, release, translation, and page-assistant templates
- [x] Category, version, source, scope, input, and step metadata
- [x] Explicit Skill selection with Use and Debug actions
- [x] Install and template-update actions

### Create and Debug

- [x] Record and test a workflow on the current page
- [x] Save as a new Skill without silently replacing an existing one
- [x] Load a recorded Skill into the editor
- [x] Update an existing Skill with patch-version increments
- [x] Run a selected Skill through the V2 observe-act-verify timeline
- [ ] Edit, reorder, disable, or delete individual recorded steps
- [ ] Persist execution metrics and failed-step diagnostics

### Durable Local Registry

- [x] Store user Skills under `~/.auto-page-agent/skills`
- [x] One-time migration from the repository `skills/` directory
- [x] Preserve installed and custom Skills across extension/repository upgrades
- [x] Support `AUTO_PAGE_AGENT_DATA_DIR` and `AUTO_PAGE_AGENT_BUNDLED_SKILLS` overrides
- [ ] Export/import a portable Skill bundle
- [ ] Signed remote/team registry and update channels
- [ ] Conflict-aware three-way updates for customized Marketplace Skills

### V3 Safety Boundary

- Installing a Marketplace Skill copies declarative instructions/workflows only; it does not grant new browser permissions.
- A selected Skill still uses the V2 constrained action protocol, approval gate, step/time budget, and result verification.
- Updating a Skill is explicit. Saving a duplicate name never silently overwrites the installed copy.

## Version 0.2 — Browser Agent Runtime

Goal: upgrade from single action execution to a reliable observe-plan-act-verify browser agent.

### Agent Loop

- [x] Internal Observe → Plan → Act → Verify execution loop
- [x] Separate answer, complete, blocked, and needs-user decisions
- [x] Require current-page evidence for browser-task completion
- [x] Maximum step budget and timeout control
- [x] Snapshot refresh after every action
- [x] Action result validation
- [x] Failure recovery and retry strategy (bounded re-plan plus navigation recovery)

### Agent Interaction UI

- [x] Agent execution timeline
- [x] Remove synthetic Observe/Plan timeline entries
- [x] Streaming assistant events
- [x] Real-time action status
- [x] Enhanced AI cursor / target overlay
- [x] Action explanation labels
- [x] Conversation-bound target tab selector
- [x] Continue a fixed-tab Agent Run while the user views another tab
- [ ] Step-by-step execution replay

### Page Understanding

- [x] Snapshot diff between actions
- [x] Detect DOM changes after execution
- [x] Element state change tracking
- [x] Better occluded/loading/disabled/read-only element handling

### Skill Runtime

- [x] Skill execution through the shared agent loop state machine
- [x] Skill step visualization through the agent timeline
- [x] Skill failure recovery through verify/re-plan
- [x] Skill variables and runtime context
- [ ] Skill execution metrics

### v0.2 Demo Targets

1. Fill daily report automatically with verification.
2. Create release form and stop before final submission.
3. Diagnose page interaction failures.
4. Explain page element behavior with execution trace.

---

## Phase 1 — current-page MVP

- [x] MV3 Side Panel
- [x] visible interactive-element snapshot
- [x] current-page text and selected-text context
- [x] Navigation and Resource Timing collection
- [x] local WebSocket bridge
- [x] local Codex app-server adapter
- [x] constrained action-plan validation
- [x] click, fill, select, scroll, focus, and submit actions
- [x] mandatory approval UI
- [x] basic `SKILL.md` discovery and selection
- [x] side-panel conversation history
- [x] local Codex thread continuity
- [x] Responses API provider and response continuity
- [x] element and image message context
- [x] compact indexed DOM with viewport pruning
- [x] AI pointer, target ring, and action status label
- [x] streaming assistant output
- [x] observe-act loop with a maximum-step budget
- [x] local current-viewport screenshot capture and preview
- [x] selected public image input in Responses API mode
- [ ] screenshot/binary image input to local Codex

## Phase 2 — local repository intelligence

- [x] configure one or more local repository roots
- [x] bounded fixed-string repository evidence search
- [x] visual page-element picker
- [x] source/symbol/text/API evidence classification with confidence levels
- [x] fetch/XHR Resource Timing URL extraction and repository correlation
- [x] Codex executable discovery and account status
- [x] app-server overload retry and structured error handling
- [ ] `repo.read_file` and TypeScript-aware `repo.find_references` tools
- [ ] Git revision and current branch awareness
- [ ] TypeScript language-service symbol lookup
- [ ] optional build transform injecting component/source metadata
- [ ] correlate request URLs with API clients and hooks
- [ ] prove selected element -> component -> hook -> request relationship
- [ ] field trace: DOM -> component -> prop -> hook -> API response type

## Phase 3 — remote company runtime

- [ ] authenticated remote Agent Server
- [ ] GitHub/GitLab/internal repository provider
- [ ] repository mirror and revision-aware indexes
- [ ] build-artifact and private source-map provider
- [ ] per-user repository and tool authorization
- [ ] audit events with sensitive-value redaction
- [ ] local/remote provider selector using one protocol

## Phase 4 — workflow Skill library

- [x] current-tab operation recorder
- [x] confirmation-gated same-page debug replay
- [x] generate `SKILL.md` and parameterized `workflow.json`
- [x] sensitive-value redaction and manual-input checkpoint
- [x] origin and path-prefix page matching
- [x] per-page Skill function list with tab/navigation refresh
- [x] configurable path wildcard matching
- [x] persistent Skill enable/disable controls
- [ ] DOM/page-fingerprint matching
- [ ] declarative required tools and permissions
- [ ] step-specific confirmation policies
- [ ] versioned team Skill registry
- [x] manual tab discovery and selection by URL/title
- [ ] automatic tab discovery by URL/title/page fingerprint
- [ ] cross-tab workflows
- [ ] failure recovery and selector/ref regeneration
- [ ] workflow success-rate and failed-step metrics

## Deferred — translation/i18n intelligence

Translation analysis is not part of the current milestones.

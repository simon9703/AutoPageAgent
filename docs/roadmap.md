# Roadmap

## Version 0.2 — Browser Agent Runtime

Goal: upgrade from single action execution to a reliable observe-plan-act-verify browser agent.

### Agent Loop

- [ ] Observe → Plan → Act → Verify execution loop
- [ ] Maximum step budget and timeout control
- [ ] Snapshot refresh after every action
- [ ] Action result validation
- [ ] Failure recovery and retry strategy

### Agent Interaction UI

- [ ] Agent execution timeline
- [ ] Streaming assistant events
- [ ] Real-time action status
- [ ] Enhanced AI cursor / target overlay
- [ ] Action explanation labels
- [ ] Step-by-step execution replay

### Page Understanding

- [ ] Snapshot diff between actions
- [ ] Detect DOM changes after execution
- [ ] Element state change tracking
- [ ] Better hidden/loading/disabled element handling

### Skill Runtime

- [ ] Skill execution state machine
- [ ] Skill step visualization
- [ ] Skill failure recovery
- [ ] Skill variables and runtime context
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
- [ ] streaming assistant output
- [ ] observe-act loop with a maximum-step budget
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
- [ ] tab discovery by URL/title/page fingerprint
- [ ] cross-tab workflows
- [ ] failure recovery and selector/ref regeneration
- [ ] workflow success-rate and failed-step metrics

## Deferred — translation/i18n intelligence

Translation analysis is not part of the current milestones.
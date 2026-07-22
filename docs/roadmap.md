# Roadmap

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
- [ ] streaming assistant output
- [ ] observe-act loop with a maximum-step budget
- [x] local current-viewport screenshot capture and preview
- [ ] screenshot input to Codex when DOM evidence is insufficient

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

Target demo:

> Select a page field and return the owning component, source file, API endpoint, and response field with evidence levels.

## Phase 3 — remote company runtime

- [ ] authenticated remote Agent Server
- [ ] GitHub/GitLab/internal repository provider
- [ ] repository mirror and revision-aware indexes
- [ ] build-artifact and private source-map provider
- [ ] per-user repository and tool authorization
- [ ] audit events with sensitive-value redaction
- [ ] local/remote provider selector using one protocol

Remote repository access must be checked server-side for every operation; the extension must never receive repository credentials.

## Phase 4 — workflow Skill library

- [x] current-tab operation recorder
- [x] confirmation-gated same-page debug replay
- [x] generate `SKILL.md` and parameterized `workflow.json`
- [x] sensitive-value redaction and manual-input checkpoint
- [x] origin and path-prefix page matching
- [x] per-page Skill function list with tab/navigation refresh
- [ ] configurable wildcard and page-fingerprint matching
- [ ] declarative required tools and permissions
- [ ] step-specific confirmation policies
- [ ] versioned team Skill registry
- [ ] tab discovery by URL/title/page fingerprint
- [ ] cross-tab workflows
- [ ] failure recovery and selector/ref regeneration
- [ ] workflow success-rate and failed-step metrics

Initial company workflows:

1. explain a page field and trace its data source;
2. diagnose slow or failed requests;
3. fill a daily report from a Codex summary;
4. create a release form but stop before submission.

## Phase 5 — deeper browser diagnostics

- [ ] opt-in `chrome.debugger` mode
- [ ] Chrome DevTools Protocol Network events
- [ ] initiator chains, status codes and failure reasons
- [ ] Core Web Vitals collector
- [ ] performance trace analysis
- [ ] console and uncaught-error correlation

The debugger permission remains separate from the default installation because it is powerful and creates additional browser warnings.

## Deferred — translation/i18n intelligence

Translation analysis is not part of the current milestones. `TODO(i18n)` markers preserve future insertion points for an explicit page key, translation-resource evidence kind, and translation-platform provider. This work should begin only after component and API-field tracing is reliable.

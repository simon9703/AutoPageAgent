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
- [ ] screenshot fallback when DOM evidence is insufficient

## Phase 2 — local repository intelligence

- [ ] configure one or more local repository roots
- [ ] `repo.search`, `repo.read_file`, and `repo.find_references` tools
- [ ] Git revision and current branch awareness
- [ ] TypeScript language-service symbol lookup
- [ ] optional build transform injecting component/source metadata
- [ ] correlate visible text with i18n keys
- [ ] correlate request URLs with API clients and hooks
- [ ] field trace: DOM -> component -> prop -> hook -> API response type

Target demo:

> Select a page field and return the owning component, source file, API endpoint, response field, and translation key with evidence levels.

## Phase 3 — remote company runtime

- [ ] authenticated remote Agent Server
- [ ] GitHub/GitLab/internal repository provider
- [ ] repository mirror and revision-aware indexes
- [ ] translation-platform provider
- [ ] build-artifact and private source-map provider
- [ ] per-user repository and tool authorization
- [ ] audit events with sensitive-value redaction
- [ ] local/remote provider selector using one protocol

Remote repository access must be checked server-side for every operation; the extension must never receive repository credentials.

## Phase 4 — workflow Skill library

- [ ] host/page-pattern matching
- [ ] declarative required tools and permissions
- [ ] step-specific confirmation policies
- [ ] versioned team Skill registry
- [ ] tab discovery by URL/title/page fingerprint
- [ ] cross-tab workflows
- [ ] failure recovery and selector/ref regeneration
- [ ] workflow success-rate and failed-step metrics

Initial company workflows:

1. explain a page field and trace its data source;
2. audit visible text and missing translations;
3. diagnose slow or failed requests;
4. fill a daily report from a Codex summary;
5. create a release form but stop before submission;
6. update translation entries and request approval.

## Phase 5 — deeper browser diagnostics

- [ ] opt-in `chrome.debugger` mode
- [ ] Chrome DevTools Protocol Network events
- [ ] initiator chains, status codes and failure reasons
- [ ] Core Web Vitals collector
- [ ] performance trace analysis
- [ ] console and uncaught-error correlation

The debugger permission remains separate from the default installation because it is powerful and creates additional browser warnings.

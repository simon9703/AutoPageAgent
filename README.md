# Auto Page Agent

A lightweight Chrome side-panel agent that understands a conversation-bound target page, analyzes browser performance, and executes explicit, reviewable DOM actions through local Codex or the OpenAI Responses API.

## MVP capabilities

- Ask questions about the current page, selected text, headings, fields, links, and visible content.
- Keep a conversation bound to its target tab while freely viewing other browser tabs.
- Inspect or explicitly switch the target from the page selector at the top of the side panel.
- Inspect Navigation Timing and the slowest/largest Resource Timing entries.
- Plan `click`, `fill`, `select`, `scroll`, `focus`, and `submit` actions.
- Validate every element reference against a versioned page snapshot.
- Show an approval card before actions execute.
- Connect to local `codex app-server` without storing API keys in extension storage.
- Load simple reusable workflows from `skills/*/SKILL.md`.
- Pick any page element and search configured local repositories for source, symbol, text, and API evidence.
- Capture the current viewport locally, preview it in the side panel, and explicitly attach it to the next Responses API message.
- Record current-tab clicks, form changes, submits, and scroll positions; test replay after confirmation.
- Save a recording as a reusable `SKILL.md` plus declarative `workflow.json` with runtime variables.
- Discover a page-specific Skill function list in the side panel and refresh it automatically on tab/navigation changes.
- Continue a conversation in the side panel, with a reusable Codex thread or Responses `previous_response_id`.
- Select a page element or image and send it as explicit message context.
- Send a Page Agent-inspired compact, indexed DOM instead of the full page tree.
- Show an AI pointer, target ring, and action label while approved DOM actions execute.
- Run a bounded observe-plan-act-verify loop with a fresh snapshot and verification after every action.
- Stream provider and runtime events into a real-time execution timeline.
- Track stable element fingerprints, occlusion, viewport, read-only, checked, expanded, and busy state.
- Rank page Skills with explicit match reasons and keep their context active across loop iterations.
- Browse Current page, My Skills, and Marketplace views in one local Skill Registry.
- Install built-in daily-report, release, translation, and page-assistant templates.
- Debug a selected Skill through the same observable agent loop, then save a new Skill or explicitly update an existing version.
- Keep user Skills in durable local storage outside the extension/repository package.
- Use a compact React + Tailwind side panel with icon-first page tools, modal Skill browsing, and a fixed conversation composer.
- Start a genuinely fresh provider conversation with **New**, clearing chat, pending actions, selected page context, Codex thread mapping, and Responses chaining state.

## Architecture

```text
Chrome Side Panel
  -> MV3 background service worker
  -> content script (snapshot + safe actions)
  -> localhost WebSocket bridge
  -> provider router
      -> codex app-server over JSON-RPC/stdin
      -> OpenAI Responses API
```

The model never receives arbitrary JavaScript execution. It produces either an answer or a constrained JSON action plan. The bridge validates the plan, and the content script resolves only element references belonging to the latest snapshot.

## Quick start

Requirements: Node.js 20+, Chrome, and either a working Codex CLI login or an OpenAI API key available to the local bridge.

```bash
npm install
npm run build
npm run dev:bridge
```

Then:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `packages/extension/dist`.
5. Open an HTTP(S) page and click the extension icon.

A new conversation binds to the tab that is active when it is created. Switching browser tabs does not move or stop the agent; use the target-page selector to change the conversation target explicitly.

To exercise the complete extension/bridge flow without starting Codex:

```bash
AUTO_PAGE_AGENT_MOCK=1 npm run dev:bridge
```

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `CODEX_PATH` | Override the detected `codex` executable. |
| `AUTO_PAGE_AGENT_PROVIDER` | `auto` (default), `codex`, or `openai`. |
| `OPENAI_API_KEY` | Enables the Responses API provider in the local bridge. Never stored by the extension. |
| `OPENAI_MODEL` | Responses model override (default `gpt-5.6-sol`). |
| `AUTO_PAGE_AGENT_PORT` | Change the localhost bridge port (default `3210`). |
| `AUTO_PAGE_AGENT_MOCK=1` | Return deterministic page analysis without Codex. |
| `AUTO_PAGE_AGENT_DATA_DIR` | Override durable user data storage (default `~/.auto-page-agent`). |
| `AUTO_PAGE_AGENT_BUNDLED_SKILLS` | Override the bundled Marketplace template directory. |

Examples:

```bash
# Prefer local Codex and its ChatGPT-managed login
AUTO_PAGE_AGENT_PROVIDER=codex npm run dev:bridge

# Use the Responses API; export the key in your shell or secret manager
AUTO_PAGE_AGENT_PROVIDER=openai OPENAI_API_KEY=... npm run dev:bridge
```

To enable local repository analysis, copy the example configuration and use absolute paths:

```bash
cp auto-page-agent.config.example.json auto-page-agent.config.json
```

```json
{
  "repositories": [
    { "name": "trade-web", "path": "/absolute/path/to/trade-web" }
  ]
}
```

Restart the bridge, click the **Select** pointer, select an element on the page, then click **Find in repositories**. Repository search uses `rg` with fixed-string arguments; model output is never executed as a shell command.

## Record an automation Skill

1. Choose the target page, click **Record** in the top tool bar, and operate that tab normally.
2. Click **Stop recording** and review the captured steps.
3. Use **Test replay** for a confirmation-gated replay on the current page.
4. Name the workflow and click **Save as new**, or load an existing recorded Skill and choose **Update Skill**.

The bridge stores user Skills in `~/.auto-page-agent/skills/<name>/` by default. On the first V3 run it migrates existing repository Skills into that durable directory; later extension and repository upgrades do not replace them. Non-sensitive typed values are retained only in Chrome session storage for the immediate test replay; saved workflows replace them with `{{runtime_variables}}`. Password, token, OTP, payment, credential, and file fields never persist their values and stop automated replay for manual input.

Generated Skills are page-scoped by origin and recorded start-path prefix. The **Skills** modal provides **This page**, **My Skills**, and **Explore** views. **Use** prepares a normal task; **Debug** asks the agent to explain and verify each Skill step. Neither bypasses the normal plan and confirmation flow.

Recorded Skills can be enabled, disabled, or assigned custom page patterns from the same card. Patterns require a fixed HTTP(S) origin and accept `*` for one path segment or `**` for multiple segments. Disabled Skills remain visible on matching pages for management but are excluded from Codex selection and cannot be run.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Current limits

- The V2 loop is intentionally bounded to 8 actions and 90 seconds; cross-tab execution and unrestricted final-submit actions remain out of scope.
- A selected public image URL is sent as `input_image` in Responses API mode. Local Codex currently receives its URL, alt text, dimensions, and surrounding DOM context rather than binary image data.
- Recorded replay targets the conversation's selected page. Navigation-aware and multi-target workflows remain planned.
- Resource Timing cannot expose all cross-origin sizes unless the resource sends `Timing-Allow-Origin`.
- The localhost bridge is intended for local development. Packaged releases should use an install-time secret or Chrome Native Messaging.
- Repository evidence search is implemented; deeper TypeScript reference tracing, API response-field tracing, source maps, and React component correlation remain planned.
- The translation Marketplace Skill preserves placeholders and supports visible translation-page workflows; repository-level i18n tracing remains deferred.

See [docs/architecture.md](docs/architecture.md), [docs/roadmap.md](docs/roadmap.md), and [docs/security.md](docs/security.md).

For the exact boundary between local Codex, OpenAI API keys, and webpage business APIs, see [docs/chromex-comparison.md](docs/chromex-comparison.md).

## License

MIT

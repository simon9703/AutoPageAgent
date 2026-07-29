# Auto Page Agent

A lightweight Chrome side-panel agent that understands a conversation-bound target page, analyzes browser performance, and executes explicit, reviewable DOM actions through local Codex or the OpenAI Responses API.

## MVP capabilities

- Ask questions about the current page, selected text, headings, fields, links, and visible content.
- Keep a conversation bound to its target tab while freely viewing other browser tabs.
- Click the page summary at the top of the side panel to return to the bound tab.
- Inspect Navigation Timing and the slowest/largest Resource Timing entries when a task explicitly asks for performance or network analysis.
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
- Resume the original browser task when the agent asks for missing user input; when choices are available, show a recommended preselected option that continues on **Start**.
- Select a page element or image as explicit one-message model context, with a compact attachment summary retained in the conversation.
- Send a Page Agent-inspired compact, indexed DOM instead of the full page tree.
- Show an AI pointer, target ring, and action label while approved DOM actions execute.
- Run a bounded browser loop with a fresh snapshot and verification after every action.
- Keep ordinary snapshots structural; collect Performance and API request evidence only for explicit analysis tasks.
- Show only meaningful model output, browser actions, verification results, and completion state in the execution timeline.
- Keep plan summaries in the approval card and runtime step counts in status/timeline UI instead of duplicating them in assistant messages.
- Track stable element fingerprints, occlusion, viewport, read-only, checked, expanded, and busy state.
- Rank page Skills with explicit match reasons and keep their context active across loop iterations.
- Browse My Skills and Marketplace views in one local Skill Registry.
- Install only the built-in `analyze-page` template by default.
- Debug a selected Skill through the same observable agent loop, then save a new Skill or explicitly update an existing version.
- Explicitly select one Skill for a conversation, or add, import, download, and delete local Skills.
- Summarize the current page conversation and observed operations into an editable Skill draft.
- Keep user Skills in durable local storage outside the extension/repository package.
- Use a compact React + Tailwind side panel with icon-first page tools, modal Skill browsing, and a fixed conversation composer.
- Start a genuinely fresh provider conversation with **New**, clearing chat, pending actions, selected page context, Codex thread mapping, and Responses chaining state.
- Keep **New** unavailable until an active run has stopped, and ignore late results or events from a stopped or different conversation.
- Keep one current conversation per browser window, with messages and pending follow-up state isolated by window.
- Persist completed and in-progress conversations with their compact Agent operation timeline under `~/.auto-page-agent/logs`.
- Open the History list beside **New** to switch conversations or delete one with its `×` action.

## Architecture

```text
Chrome Side Panel
  -> MV3 background service worker
  -> content script (snapshot + safe actions)
  -> Chrome Native Messaging
  -> on-demand local bridge
  -> provider router
      -> codex app-server over JSON-RPC/stdin
      -> OpenAI Responses API
```

The model never receives arbitrary JavaScript execution. It produces a constrained decision: answer, action plan, complete, blocked, or needs user. The bridge validates every decision, including bounded choice lists and their recommended option, and the content script resolves only element references belonging to the latest snapshot. An action result or navigation is never treated as whole-task completion; `complete` requires current-page evidence.

## Quick start

Requirements: Node.js 20+, Chrome, and a working Codex CLI ChatGPT login.

```bash
npm install
npm install -g @openai/codex
codex login
npm run bridge
```

Then:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `packages/extension/dist`.
5. Open an HTTP(S) page and click the extension icon.

`npm run bridge` builds the project and registers `com.auto_page_agent.bridge` for Chrome once. Chrome starts the bridge automatically when the extension connects, so `npm run dev:bridge` and a permanently running localhost service are no longer needed. After reinstalling or moving the source package, run the command again and reload the extension.

If the bridge is missing or Codex is not signed in, the side panel shows a **Reconnect** action and keeps message sending disabled. Run `codex login` when prompted, complete the ChatGPT login, then click **Reconnect**.

When the side panel opens, an empty conversation follows the active HTTP(S) tab in that browser window. Sending the first message locks the conversation to that page; later tab switches do not move or stop the agent, while navigation inside the bound tab remains part of the same conversation. Click **New** to create another empty conversation, which follows the currently viewed tab until its first message. The adjacent History action restores saved messages and operations while keeping the original target binding; it never silently binds a historical conversation to the currently viewed tab. If the original tab has closed, the history remains readable but page actions require a new conversation.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `CODEX_PATH` | Override the detected `codex` executable. |
| `AUTO_PAGE_AGENT_PROVIDER` | `auto` (default), `codex`, or `openai`. |
| `OPENAI_API_KEY` | Enables the Responses API provider in the local bridge. Never stored by the extension. |
| `OPENAI_MODEL` | Responses model override (default `gpt-5.6-sol`). |
| `AUTO_PAGE_AGENT_MOCK=1` | Return deterministic page analysis without Codex. |
| `AUTO_PAGE_AGENT_DATA_DIR` | Override durable user data storage (default `~/.auto-page-agent`). |
| `AUTO_PAGE_AGENT_BUNDLED_SKILLS` | Override the bundled Marketplace template directory. |

Environment overrides must be available to Chrome's native-host process. For normal use, keep the default local Codex provider and its ChatGPT-managed login.

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

Run `npm run bridge` again after changing this configuration, click **Reconnect**, select an element on the page, then click **Find in repositories**. Repository search uses `rg` with fixed-string arguments; model output is never executed as a shell command.

## Record an automation Skill

1. Choose the target page, click **Record** in the composer, and operate that tab normally. The recorder captures live form values, checkboxes/radios, selects, window or container scrolling, navigation, and bounded key-frame screenshots.
2. Click **Stop recording** and review the captured steps and screenshot previews.
3. Use **Test replay** for a confirmation-gated replay on the current page.
4. Name the workflow, edit its reusable instructions, and click **Save Skill**, or load an existing recorded Skill and choose **Update Skill**.

The bridge stores user Skills in `~/.auto-page-agent/skills/<name>/` by default. On the first V3 run it migrates existing repository Skills into that durable directory; later extension and repository upgrades do not replace them. Non-sensitive typed values are retained only in Chrome session storage for the immediate test replay; saved workflows replace them with `{{runtime_variables}}`. Password, token, OTP, payment, credential, and file fields never persist their values and stop automated replay for manual input.

Conversation history is stored beside Skills in `~/.auto-page-agent/logs/<conversation-id>.json`. Each bounded log contains compact messages, page metadata, pending continuation state, and real Action/Verify/Complete/Error events. Screenshot data URLs, ephemeral DOM refs, and recorded form values are not written to logs.

Generated Skills are reusable across routes, domains, and deployment environments. The recorded start URL, step URLs, selectors, and optional page patterns are navigation and recommendation hints rather than execution gates. The **Skills** modal provides **My Skills** and **Skills Marketplace** views. My Skills contains every local Skill, with current-page relevance used only for ordering. Its header creates or imports Skills; each installed Skill can be selected, downloaded, edited, enabled/disabled, or deleted. **Debug** asks the agent to explain and verify each Skill step. Neither selection nor debug bypasses the normal plan and confirmation flow.

The **Summarize as Skill** action below the conversation combines the bound page, recent user/Agent messages, runtime action/verification notes, and any current recording into an editable Skill draft. Screenshot binaries remain session-only and are not written into `workflow.json`.

Recorded Skills can be enabled or disabled from the same card. Existing page patterns are retained for compatibility and may improve recommendation order, but never prevent a Skill from appearing or running on another page or environment. Disabled Skills remain visible for management but are excluded from Codex selection and cannot be run.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Current limits

- The V2 loop is intentionally bounded to 8 actions and 90 seconds; cross-tab execution and unrestricted final-submit actions remain out of scope.
- Visual input is adaptive rather than per-step: obvious canvas/video or sparse large-image pages, plus the first blocked decision after bounded DOM recovery, can attach one active-viewport image. Both Responses API and Local Codex receive it; actions and completion evidence remain DOM/URL constrained.
- Recorded replay targets the conversation's selected page. Navigation-aware and multi-target workflows remain planned.
- Resource Timing cannot expose all cross-origin sizes unless the resource sends `Timing-Allow-Origin`.
- The native-host installer currently targets Chrome-family browsers on macOS, Windows, and Linux; browser-store packaging is still deferred.
- Repository evidence search is implemented; deeper TypeScript reference tracing, API response-field tracing, source maps, and React component correlation remain planned.
- The translation Marketplace Skill preserves placeholders and supports visible translation-page workflows; repository-level i18n tracing remains deferred.

See [docs/architecture.md](docs/architecture.md), [docs/roadmap.md](docs/roadmap.md), and [docs/security.md](docs/security.md).

For the exact boundary between Local Codex, the Responses provider, browser execution, and webpage business APIs, see [docs/architecture.md](docs/architecture.md) and [docs/features.md](docs/features.md).

## License

MIT

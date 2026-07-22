# Auto Page Agent

A lightweight Chrome side-panel agent that understands the current page, analyzes browser performance, and executes a small set of explicit, reviewable DOM actions through a local Codex runtime.

## MVP capabilities

- Ask questions about the current page, selected text, headings, fields, links, and visible content.
- Inspect Navigation Timing and the slowest/largest Resource Timing entries.
- Plan `click`, `fill`, `select`, `scroll`, `focus`, and `submit` actions.
- Validate every element reference against a versioned page snapshot.
- Show an approval card before actions execute.
- Connect to local `codex app-server` without storing API keys in extension storage.
- Load simple reusable workflows from `skills/*/SKILL.md`.
- Pick any page element and search configured local repositories for source, symbol, text, and API evidence.
- Capture the current viewport locally and preview it in the side panel.
- Record current-tab clicks, form changes, submits, and scroll positions; test replay after confirmation.
- Save a recording as a reusable `SKILL.md` plus declarative `workflow.json` with runtime variables.
- Discover a page-specific Skill function list in the side panel and refresh it automatically on tab/navigation changes.

## Architecture

```text
Chrome Side Panel
  -> MV3 background service worker
  -> content script (snapshot + safe actions)
  -> localhost WebSocket bridge
  -> codex app-server over JSON-RPC/stdin
```

The model never receives arbitrary JavaScript execution. It produces either an answer or a constrained JSON action plan. The bridge validates the plan, and the content script resolves only element references belonging to the latest snapshot.

## Quick start

Requirements: Node.js 20+, Chrome, and a working Codex CLI login.

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

To exercise the complete extension/bridge flow without starting Codex:

```bash
AUTO_PAGE_AGENT_MOCK=1 npm run dev:bridge
```

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `CODEX_PATH` | Override the detected `codex` executable. |
| `AUTO_PAGE_AGENT_PORT` | Change the localhost bridge port (default `3210`). |
| `AUTO_PAGE_AGENT_MOCK=1` | Return deterministic page analysis without Codex. |

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

Restart the bridge, click **Pick element**, select an element on the page, then click **Find in repositories**. Repository search uses `rg` with fixed-string arguments; model output is never executed as a shell command.

## Record an automation Skill

1. Click **Record workflow** and operate the current tab normally.
2. Click **Stop recording** and review the captured steps.
3. Use **Test replay** for a confirmation-gated replay on the current page.
4. Name the workflow and click **Save Skill**.

The bridge creates `skills/<name>/SKILL.md` and `workflow.json`. Non-sensitive typed values are retained only in Chrome session storage for the immediate test replay; saved workflows replace them with `{{runtime_variables}}`. Password, token, OTP, payment, credential, and file fields never persist their values and stop automated replay for manual input.

Generated Skills are page-scoped by origin and recorded start-path prefix. The **Page Skills** card shows matching page Skills first and global hand-written Skills second. Selecting **Use** prepares a Codex task; it does not execute browser actions until the normal plan and confirmation flow completes.

Recorded Skills can be enabled, disabled, or assigned custom page patterns from the same card. Patterns require a fixed HTTP(S) origin and accept `*` for one path segment or `**` for multiple segments. Disabled Skills remain visible on matching pages for management but are excluded from Codex selection and cannot be run.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Current limits

- The MVP performs one analysis/plan turn at a time; iterative observe-act loops are on the roadmap.
- Screenshot capture currently provides local visual evidence and preview only; sending image input to Codex is planned separately.
- Recorded replay targets the current page. Navigation-aware and cross-tab replay remain planned.
- Resource Timing cannot expose all cross-origin sizes unless the resource sends `Timing-Allow-Origin`.
- The localhost bridge is intended for local development. Packaged releases should use an install-time secret or Chrome Native Messaging.
- Repository evidence search is implemented; deeper TypeScript reference tracing, API response-field tracing, source maps, and React component correlation remain planned.
- Translation/i18n analysis is deliberately deferred. `TODO(i18n)` extension markers are preserved in the protocol, collector, and repository analyzer.

See [docs/architecture.md](docs/architecture.md), [docs/roadmap.md](docs/roadmap.md), and [docs/security.md](docs/security.md).

For the exact boundary between local Codex, OpenAI API keys, and webpage business APIs, see [docs/chromex-comparison.md](docs/chromex-comparison.md).

## License

MIT

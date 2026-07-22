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

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Current limits

- The MVP performs one analysis/plan turn at a time; iterative observe-act loops are on the roadmap.
- Resource Timing cannot expose all cross-origin sizes unless the resource sends `Timing-Allow-Origin`.
- The localhost bridge is intended for local development. Packaged releases should use an install-time secret or Chrome Native Messaging.
- Repository evidence search is implemented; deeper TypeScript reference tracing, API response-field tracing, source maps, and React component correlation remain planned.
- Translation/i18n analysis is deliberately deferred. `TODO(i18n)` extension markers are preserved in the protocol, collector, and repository analyzer.

See [docs/architecture.md](docs/architecture.md), [docs/roadmap.md](docs/roadmap.md), and [docs/security.md](docs/security.md).

For the exact boundary between local Codex, OpenAI API keys, and webpage business APIs, see [docs/chromex-comparison.md](docs/chromex-comparison.md).

## License

MIT

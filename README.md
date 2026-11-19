# Open Artifact

English · [简体中文](README.zh-CN.md)

> **Formerly `baoyu-design`.** This project started as
> [baoyu-design](https://github.com/JimLiu/baoyu-design) (the old URL redirects here), which brought claude.ai-style
> Artifact types to local coding agents as one skill per type. Open Artifact rebuilds them as an open, agent-agnostic
> format: one local daemon, one page frame, one `/open-artifact` skill, and a plugin for each agent app.

**Open Artifact lets any coding agent make things people can open, edit and comment on, not just files.** You ask
your agent for a slide deck, a UI design, a design system, a whiteboard, a spreadsheet, a data dashboard or a doc. The agent writes a plain folder of files.
A local page opens it in a real editor, where you can fix a title, move a sticky note, leave comments, and export. Then
"Send to agent" sends your comments back to the agent's session.

Everything runs on your machine. No account, no upload, no specific model or vendor.

```
  you ──"/open-artifact slides a 6-slide pitch"──▶ agent (Claude Code, Codex, Cursor, Copilot, …)
                                                     │ writes files
                                                     ▼
                                           ./my-deck/project/deck.json + slides/*.html
                                                     │ served by the local daemon
                                                     ▼
  you ◀── edit · comment · export (PDF/PPTX/PNG/HTML) ── http://127.0.0.1:<port>/a/<id>
   └──────────────── "Send to agent" ──────────────▶ comments arrive back in the agent's session
```

## Artifact types

| Type | What you get | Folder marker | Exports |
|---|---|---|---|
| [Slides](artifact-types/slides/SKILL.md) | A 1920×1080 deck: slide rail, overview, speaker notes, builds, transitions, presenter mode | `project/deck.json` | PDF, PPTX, HTML, PNG |
| [Design](artifact-types/design/SKILL.md) | An infinite canvas of live `.dc.html` artboards: screens, components, click-through prototypes, notes, pages | `project/canvas.json` | PNG, JPEG, PDF, HTML |
| [Design System](artifact-types/design-system/SKILL.md) | A brand book: tokens, colors with contrast checks, type specimens, live component previews, assets. Designs and decks can install it | `project/design-system.json` | — |
| [Whiteboard](artifact-types/whiteboard/SKILL.md) | A shared infinite board: stickies, shapes, arrows, ink, images, tables, embeds, live cursors, timer | `db/board/meta.json` | PNG |
| [Sheets](artifact-types/sheets/SKILL.md) | A shared spreadsheet: several sheets of cells, a full formula engine, number formats, borders, merged cells, tables with filters, dropdowns, checkboxes, conditional formats, frozen and grouped rows, charts from cells, CSV import, cell history | `sheet/sheet.json` | XLSX, CSV |
| [Data](artifact-types/data/SKILL.md) | A live dashboard or report: datasets from CSV/JSON/text uploads, live MCP connector queries or calculations, drawn by a plain HTML/CSS/d3 page; Sources shows where each number comes from; filters, hand edits, remix drafts | `db/dash/meta.json` | PDF, HTML, JSON |
| [Docs](artifact-types/docs/SKILL.md) | A living document in tabs: headings, lists, tables, pictures, dates, mentions and dropdowns; suggested edits to accept or reject, comments, a version history per tab; imports Markdown, Word and PDF | `doc/doc.json` | Markdown, Word, PDF, HTML |

Each type folder is a self-contained skill: `SKILL.md` tells the agent how to write it, `reference/` documents the
file format, `artifact-type.json` describes it to hosts, and `scripts/` (built) holds the CLI and editors.

## Quick start

Requires **Node.js 22.18+**.

```bash
npm ci
npm run build
```

Then pick the way you want to use it.

### 1. As a plugin in your agent app (recommended)

```bash
node scripts/build-plugins.mjs      # writes dist/plugins/, a marketplace folder
```

Then install it in your agent app. The commands below run from the repository folder; each plugin folder in
`dist/plugins/` carries the skill and the daemon, and needs Node.js 22 or later on the computer.

| Agent app | Install |
|---|---|
| [Claude Code](plugins/claude-code/README.md) (CLI, desktop, IDE) | `claude plugin marketplace add ./dist/plugins`, then `claude plugin install open-artifact@open-artifact` |
| [Codex](plugins/codex/README.md) (CLI, app) and ChatGPT desktop | `codex plugin marketplace add ./dist/plugins`, then install **Open Artifact** from `/plugins` (CLI) or the Plugins tab (app) |
| [Cursor](plugins/cursor/README.md) | copy `dist/plugins/cursor` to `~/.cursor/plugins/local/open-artifact`, then **Developer: Reload Window** |
| [GitHub Copilot](plugins/copilot/README.md) CLI | `copilot plugin marketplace add ./dist/plugins`, then `copilot plugin install open-artifact@open-artifact` |
| [GitHub Copilot](plugins/copilot/README.md) in VS Code | turn on `chat.plugins.enabled`, then **Chat: Install Plugin from Source** and pick `dist/plugins/copilot` |
| [Antigravity](plugins/antigravity/README.md) | `agy plugin install ./dist/plugins/antigravity` (or copy the folder to `~/.gemini/config/plugins/open-artifact/`), then restart the app |
| [ChatGPT on the web](plugins/chatgpt/README.md) | run the connector, put it behind an HTTPS tunnel and add it as a custom MCP server (steps in its README) |
| DeepSeek Harness | add the `plugins/dsh` folder as a local plugin; `npm run build` builds it, and the app links the folder in place |

For example, Claude Code:

```bash
claude plugin marketplace add ./dist/plugins
claude plugin install open-artifact@open-artifact
```

Cursor:

```bash
mkdir -p ~/.cursor/plugins/local && cp -R ./dist/plugins/cursor ~/.cursor/plugins/local/open-artifact
```

A few apps need one more step:

- **Codex** runs plugin hooks only after you approve them in `/hooks`, and again after each update.
- **Antigravity** loads a plugin's MCP server only at startup, and asks you to allow each tool call until you choose
  to always allow it.
- To try a plugin in one session without installing it: `claude --plugin-dir ./dist/plugins/claude-code` or
  `copilot --plugin-dir ./dist/plugins/copilot`.

After rebuilding, install again (or copy the folder again) to update. Then, in a new session:

```text
/open-artifact slides a 6-slide pitch for this repo
/open-artifact design three landing page options for a coffee shop
/open-artifact whiteboard a retro board for last sprint
/open-artifact sheets a monthly budget with categories and totals
/open-artifact data a dashboard of signups by month from signups.csv
/open-artifact docs a hiring plan for 2027 with roles, budget and timeline
```

The plugin adds the `Artifact`, `ArtifactData` and `ArtifactComments` MCP tools, the skill, and hooks that bring
page comments back into the session. How each app gets comments back, and what was tested in each, is in
[plugins/README.md](plugins/README.md).

Using DSH on a remote server? [Remote HTTPS hosting](docs/remote-hosting.md) adds shared UI settings,
authenticated owner links and isolated editor origins behind your TLS reverse proxy.

### 2. As a skill for any other agent

Copy or point your agent at [`skills/open-artifact/`](skills/open-artifact/SKILL.md) (built by
`build-plugins.mjs`, or alone with `node scripts/build-skill.mjs`). It carries the daemon, and the agent drives it
from the command line:

```bash
node skills/open-artifact/scripts/open-artifact.mjs artifact '{"action":"list","scope":"types"}'
```

### 3. One type on its own

Every built type folder runs by itself, without the daemon:

```bash
node artifact-types/design/scripts/cli.mjs open ./my-design --type design   # starts a local server, prints the URL
node artifact-types/design/scripts/cli.mjs wait ./my-design                 # blocks until someone presses "Send to agent"
```

Other commands: `check`, `generate`, `upload`, `context`, `comments`, `history`, `share`, `status`, `stop`, … Run the
CLI with no arguments for the full list.

## Development

```bash
npm run build        # editors, support.js, the CLI, the Shell and the DSH plugin → dist/ and artifact-types/*/scripts/
npm run typecheck
npm test             # unit tests (node --test)
npm run e2e          # end-to-end: drives the built types with the CLI and Chrome, see e2e/README.md
```

The Rust crates in `crates/` compile to WebAssembly. Their output is committed under `packages/wasm-*/generated/`,
so you only need Rust when you change a crate:

```bash
node scripts/build-wasm.mjs   # needs cargo + wasm32-unknown-unknown, wasm-bindgen, wasm-opt
```

### Releasing to npm

`node scripts/build-npm.mjs` stages the npm packages in `dist/npm/`: the `@open-artifact/*` libraries (compiled to
JavaScript with type declarations), `@open-artifact/cli` (the `open-artifact` command with the daemon vendored) and
`dsh-open-artifact`. To release, raise the versions you want out and push a tag (`v0.2.0`); the
[Publish to npm](.github/workflows/publish-npm.yml) workflow builds and publishes every version npm does not have yet,
by trusted publishing. A package npm doesn't have yet is claimed once from a computer before its first release:
`node scripts/publish-npm.mjs --claim` sets the workflow as its trusted publisher, and npm creates it with a placeholder.
`node scripts/publish-npm.mjs` publishes from a computer too (`--dry-run` to look first).

## Repository layout

| Path | Contents |
|---|---|
| `artifact-types/` | The seven types as skills: `SKILL.md`, `reference/`, `artifact-type.json`. |
| `skills/open-artifact/` | The one `/open-artifact <type>` skill; `vendor/` (built) carries the daemon. |
| `plugins/` | The skill packaged per agent app, with hooks and MCP config ([README](plugins/README.md)). |
| **Platform** | |
| `packages/daemon` | The `open-artifact` daemon: type registry, artifact library, agent tools, MCP, wake routing, the Harness API. |
| `packages/shell` | The daemon's pages: the Shell frame around every artifact, and the home page. |
| `packages/protocol` | Typed contracts shared by the daemon, harness adapters, type servers, the Shell and pages. |
| `packages/runtime` | `window.openartifact`, the capability API pages use (files, uploads, user, agent, presence, downloads). |
| `packages/type-server`, `packages/server-sdk` | The per-type local server and `cli.mjs`; shared server code. |
| **Types** | |
| `packages/slides-core`, `slides-editor` | Slides model (HTML subset, `deck.json`) and editor. |
| `packages/design-core`, `design-editor`, `dc` | Design model (`canvas.json`), editor, and the `.dc.html` artboard format. |
| `packages/design-system-core`, `design-system-editor` | Design System model (token grammar, CSS compiler) and editor. |
| `packages/whiteboard-core`, `whiteboard-editor` | Whiteboard model (schema, live sync, geometry) and editor. |
| `packages/sheets-core`, `sheets-editor` | Sheets model (workbook, cells, styles, tables, charts) and editor. |
| `packages/data-core`, `data-editor` | Data model (datasets, queries, rules, the dashboard page) and editor. |
| `packages/docs-core`, `docs-editor` | Docs model (blocks and characters with ids, ops, suggestions, markdown) and editor. |
| **Shared** | |
| `packages/live-store` | Live document sync shared by Whiteboard and Data. |
| `packages/ui`, `editor-kit`, `export-kit` | UI kit (Base UI + Tailwind), what editors share (comments, history, presence…), browser-side exports. |
| `packages/canvas-engine`, `wasm-*`, `crates/` | WebGL2 canvas engine and the Rust/WebAssembly crates behind it, exports, whiteboard geometry, data rules and the sheets formula engine. |
| `e2e/` | End-to-end tests. |
| `scripts/` | `build.mjs`, `build-plugins.mjs`, `build-skill.mjs`, `build-wasm.mjs`. |

## License

[Apache License 2.0](LICENSE). Copyright 2026 Jim Liu 宝玉; see [NOTICE](NOTICE).

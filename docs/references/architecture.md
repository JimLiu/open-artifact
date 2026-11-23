# Architecture reference

Load this reference when working across packages, daemon/Shell communication, MCP tools, hooks, hosting, or WASM crates.

## High-level data flow

```text
Agent app (Claude Code, Codex, Cursor, Copilot, Antigravity, ZCode, DSH, ChatGPT, or CLI)
   │  MCP tools (Artifact, ArtifactData, ArtifactComments, ShowArtifact) or CLI
   ▼
packages/daemon (local open-artifact daemon, one per machine)
   ├── Type Registry (reads artifact-types/*/artifact-type.json + SKILL.md)
   ├── Artifact Store (maps artifact ids <-> local folders, tracks changed_files)
   ├── Type Servers (spawns per-type servers via packages/type-server)
   ├── Shell & Home UI (packages/shell served at http://127.0.0.1:<port>/a/<id>)
   ├── Inbox & Wake Routing (routes page comments/"Send to agent" back to agent sessions via hooks/adapters)
   └── Remote Link (syncs published artifacts to a self-hosted Node or Cloudflare site)
```

## Package map

### Core platform

| Package | Responsibility |
| --- | --- |
| `packages/protocol` | Shared TypeScript types, tool schemas (`Artifact`, `ArtifactData`, `ArtifactComments`), error codes, and Shell/page/daemon contracts. |
| `packages/daemon` | Local daemon: type registry, artifact library, tool handlers (`src/tools.ts`), MCP server (`src/mcp.ts`), MCP Apps (`src/mcp-app.ts`), Harness API, wake/nudge routing, remote link client. |
| `packages/shell` | Global frame around every artifact (title bar, Share/Export panels, comments/history triggers, "Send to agent") and the local home library page. |
| `packages/runtime` | `window.openartifact` capability API exposed to editor pages (files, uploads, user session, agent channel, presence, downloads, history). |
| `packages/type-server` | Local per-type HTTP/WebSocket server and `cli.mjs` entrypoint copied into `artifact-types/<type>/scripts/`. |
| `packages/server-sdk` | Shared server primitives and frame-host support used by `type-server` and hosts. |
| `packages/live-store` | Real-time JSON document sync store shared by `whiteboard`, `data`, and `motion`. |
| `packages/harness-kit` | The SDK an agent app builds its adapter on: `createHarness` (connect, start the newest compatible runtime, reconnect, sessions, tools, wakes, pages, `runtime.status()`/`runtime.update()`), `./embed` (Shell embedding in a renderer, no Node), `./testing` (a fake daemon that lists the real daemon's features). See `packages/harness-kit/README.md`. |

### Artifact type packages

| Type | Packages |
| --- | --- |
| Slides | `packages/slides-core`, `packages/slides-editor` |
| Design | `packages/design-core`, `packages/design-editor`, `packages/dc` (`.dc.html` format & `support.js` runtime) |
| Design System | `packages/design-system-core`, `packages/design-system-editor` |
| Whiteboard | `packages/whiteboard-core`, `packages/whiteboard-editor` |
| Sheets | `packages/sheets-core`, `packages/sheets-editor` |
| Data | `packages/data-core`, `packages/data-editor` |
| Docs | `packages/docs-core`, `packages/docs-editor` |
| Motion | `packages/motion-core`, `packages/motion-stage`, `packages/motion-audio`, `packages/motion-export`, `packages/motion-editor` |

### Shared UI, canvas, export & WASM

| Package / Crate | Responsibility |
| --- | --- |
| `packages/ui` | Shared UI primitives (Base UI + Tailwind CSS). |
| `packages/editor-kit` | Shared editor controllers & React views (comments, version history, presence, find, merge, Shell bridge). See `packages/editor-kit/README.md`. |
| `packages/export-kit` | Browser-side export helpers (PDF, PNG, HTML, etc.). |
| `packages/canvas-engine` | Shared WebGL2 infinite canvas rendering engine. |
| `crates/open-artifact-canvas` → `packages/wasm-canvas` | Rust/WASM canvas engine core. |
| `crates/open-artifact-export` → `packages/wasm-export` | Rust/WASM binary exporters (e.g., PPTX/XLSX/PDF helpers). |
| `crates/open-artifact-wb-geom` → `packages/wasm-wb-geom` | Rust/WASM whiteboard geometry & routing. |
| `crates/open-artifact-data-rules` → `packages/wasm-data-rules` | Rust/WASM data filter & parameter validation rules. |
| `crates/open-artifact-sheets` → `packages/wasm-sheets` | Rust/WASM spreadsheet formula parser & calculation engine. |
| `crates/open-artifact-motion` → `packages/wasm-motion` | Rust/WASM motion encoding (GIF/MOV) and flash-safety analysis. |

### Self-hosting & plugins

| Path | Responsibility |
| --- | --- |
| `packages/host` | Node.js self-hosted site server (`packages/host/README.md`). |
| `packages/host-cloudflare` | Cloudflare Workers + D1 + Durable Objects site (`deploy/cloudflare/README.md`). |
| `packages/host-plugin` | Plugin contract for custom auth, permissions, policy rules, webhooks, and invite emails (`packages/host-plugin/README.md`). |
| `plugins/` | Per-agent-app bundles (MCP stdio bridge, hooks, monitors/extensions, skill). See `plugins/README.md`. |
| `examples/` | Runnable agent-app integrations (`harness-node`, `harness-electron`, `harness-stdio`) and host plugins. See `examples/README.md`. |

## Agent tools & wake loop

- **Tools** (defined in `packages/protocol/src/tools.ts`, implemented in `packages/daemon/src/tools.ts`):
  - `Artifact`: `quickstart`, `list`, `publish`, `read`, `open`, `call`, `adopt`, `delete`, `share`.
  - `ArtifactData`: `get`, `list`, `query`, `set`, `update`, `delete`, `str_replace`, `batch`.
  - `ArtifactComments`: `read`, `reply`, `resolve`, `reopen`, `wait`.
  - `ShowArtifact` (`packages/daemon/src/mcp-app.ts`): exposed only to MCP clients declaring the `io.modelcontextprotocol/ui` extension.
- **CLI parity**: `skills/open-artifact/scripts/open-artifact.mjs` invokes the exact same daemon tool handlers over local HTTP (`artifact`, `data`, `comments`, `open`, `wait`, `mcp`, `hook`). `open-artifact --version` / `-v` prints the runtime's version.
- **Wake routing**: When a user clicks **Send to agent** in the Shell, comments go to the session that owns the artifact: live to a connected Harness API adapter of its harness (`wake.deliver`), else into the daemon inbox, delivered via app-specific hooks (`packages/daemon/harnesses/<name>.json`), background monitors/extensions, the `messages` array in tool responses, or `ArtifactComments {action: "wait"}`.

## Harness API & agent-product integration

Agent apps integrate through the Harness API, JSON-RPC 2.0 over the WebSocket `/__harness` (subprotocol
`open-artifact-harness`), over HTTP long polling, or over `open-artifact harness --stdio`. The user-facing guide is
`docs/integrating.md`; the references are `docs/spec/harness-api.md`, `docs/spec/embed.md` and `docs/spec/profile.md`.

| Module (`packages/daemon/src/`) | Responsibility |
| --- | --- |
| `harness.ts` | The WebSocket and polling endpoints, `hello`, sessions, tool calls, `host.open`, `wake.deliver`, events. |
| `harness-features.ts` | The feature names `hello` lists and the protocol versions (`PROTOCOL_MIN`/`PROTOCOL_MAX`). Within a version, only additions. |
| `stdio-bridge.ts` | `harness --stdio`: JSON lines on stdin/stdout; starts the daemon, says `hello` with the token, reconnects and attaches sessions again. |
| `harness-profiles.ts`, `hook-dialects.ts`, `nudge.ts` | Shipped (`packages/daemon/harnesses/*.json`), adapter-reported and person-added profiles; hook input/output formats; waking idle sessions. |
| `harness-skill.ts` | `skill.get` and `commands.list`: the skill and the per-type commands rendered for a harness. |
| `harness-embed.ts`, `harness-view.ts` | Declared host origins and view tickets for top-level views; `view.context` for the owner session. |
| `ownership.ts`, `release-guard.ts` | Which session owns an artifact (and when that moves); artifacts written by a newer type release are read-only. |
| `runtime.ts`, `cli-runtime.ts`, `sea.ts` | Runtimes on this computer, update policy and checked updates, `open-artifact runtime …`; the single executable's entry (`scripts/build-sea.mjs`). |
| `doctor.ts`, `doctor-checks.ts`, `doctor-remote.ts`, `doctor-conformance.ts` | `open-artifact doctor`: setup checks (including `node-children`, how type servers run), remote-type probes, and with `--session` the conformance run of a running app. |
| `servers.ts`, `node-children.ts` | Type servers: start, ready, restart on a type change, idle stop. A server whose command is `node` runs as a child process (the daemon's executable with `ELECTRON_RUN_AS_NODE=1`) or, when the daemon runs inside an Electron process (`process.type` set, as in a utility process, which an app with the `RunAsNode` fuse off uses), in a worker thread of the daemon; decided from how the daemon runs, nothing is started to find out. `OPEN_ARTIFACT_NODE_CHILDREN=process\|threads` forces one; the choice is in `/__open-artifact/health` as `nodeChildren`. |

The kit (`packages/harness-kit/src/`) mirrors this from the app side: `harness.ts` (`createHarness`), `client.ts`
(the JSON-RPC client), `runtimes.ts` (which runtime to start), `daemon.ts` (`ensureDaemon`; a host's `daemon.spawn` starts
the process itself, as an Electron app does with `utilityProcess.fork`), `skill.ts`, `context.ts`, `embed/` and `testing.ts`.
Shell-side, `packages/shell/src/shell/bridge.ts`, `view-channel.ts` and `lib/host-origins.ts` speak the host messages
of `packages/protocol/src/shell.ts`.

Between the Shell and its framed page, `bridge.ts` speaks the chrome messages of the same file (`chrome_hello`,
`chrome_report`, `chrome_cmd`). The Shell covers the frame while its document loads and lifts the cover on the page's
first report, on `load` for a static page, or `FRAME_READY_FALLBACK_MS` after `load`. A static page never reports, so
a document it navigates to shows at once, with no cover. A page that reports `ready: false` keeps the cover until it
reports otherwise, for at most `CHROME_READY_TIMEOUT_MS`; once the page has been shown, `ready: false` is ignored until
the frame loads another document. When the Shell itself reloads the frame (Refresh, or files changed under a static
page), reports that come before the next `load` are the old document's and are ignored: the new one answers that
`load`'s `chrome_hello`. `saved: 'saving'` covers edits waiting
out a write debounce (the Shell shows it after `SAVING_SHOWN_AFTER_MS`); `unsaved` means a save failed. The runtime's
`shellArtifactId()` (also `ShellConnection.artifactId`) reads the artifact id the Shell puts on the page address: on a
cloud host the page path carries a page token that changes on every load, so per-artifact memory in the page's browser
storage is keyed by that id (the whiteboard keeps its camera, saved copy, load marker and agent status this way).

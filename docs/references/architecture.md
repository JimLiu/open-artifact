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

## Agent tools & wake loop

- **Tools** (defined in `packages/protocol/src/tools.ts`, implemented in `packages/daemon/src/tools.ts`):
  - `Artifact`: `quickstart`, `list`, `publish`, `read`, `open`, `call`, `adopt`, `delete`, `share`.
  - `ArtifactData`: `get`, `list`, `query`, `set`, `update`, `delete`, `str_replace`, `batch`.
  - `ArtifactComments`: `read`, `reply`, `resolve`, `reopen`, `wait`.
  - `ShowArtifact` (`packages/daemon/src/mcp-app.ts`): exposed only to MCP clients declaring the `io.modelcontextprotocol/ui` extension.
- **CLI parity**: `skills/open-artifact/scripts/open-artifact.mjs` invokes the exact same daemon tool handlers over local HTTP (`artifact`, `data`, `comments`, `open`, `wait`, `mcp`, `hook`).
- **Wake routing**: When a user clicks **Send to agent** in the Shell, comments enter the daemon inbox and are delivered back to the active session via app-specific hooks (`packages/daemon/harnesses/<name>.json`), background monitors/extensions, the `messages` array in tool responses, or `ArtifactComments {action: "wait"}`.

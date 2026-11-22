# Artifact types developer reference

Load this reference when modifying an existing artifact type, adding a new type, or working on `artifact-types/`, `type-server`, or `*-core` / `*-editor` packages.

## Built-in artifact types & storage styles

Open Artifact supports three storage architectures across its 8 built-in types:

| Style | Types | On-disk layout | How agents write |
| --- | --- | --- | --- |
| **Project files (`project`)** | `slides`, `design`, `design-system` | Index JSON + content files under `<root>/project/` (e.g., `project/deck.json`, `project/canvas.json`, `project/design-system.json`) | Direct file writes under `<root>/project/` (or `Artifact publish`), plus `check` / `upload` actions. |
| **Live document store (`db`)** | `whiteboard`, `data`, `motion` | Small JSON documents under `<root>/db/<collection>/<id>.json`, synced via `@open-artifact/live-store` | `ArtifactData` (`get`/`list`/`query`/`set`/`update`/`delete`/`str_replace`/`batch`) or standalone `open-artifact write-db`. |
| **Operational log / structured store (`sheet` / `doc`)** | `sheets`, `docs` | `sheet/sheet.json` + `sheet/edits.jsonl` (Sheets); `doc/doc.json` + character/block-ID tabs (Docs) | Structured `Artifact {action: "call", name: "read" \| "update" \| "batch" \| ...}` or standalone CLI commands; never hand-edit raw store files. |

Shared folder conventions across all types:
- `<root>/_blobs/` — Content-addressed uploads (`/_blob/<sha256-prefix>`). Managed via `upload` / `delete-asset`; agents never write here directly.
- `<root>/_agent/` — Local page-to-agent request channel.
- `<root>/comments.json` — Comment threads.
- `<root>/history/` — Version history snapshots.
- `<root>/.artifact.json` — Local server metadata.

## Anatomy of an `artifact-types/<type>/` folder

| File / Dir | Tracked in git? | Purpose |
| --- | --- | --- |
| `artifact-type.json` | Yes | Machine-readable manifest read by the daemon and hosts: `slug`, `name`, `title`, `description`, `intents`, `when`, `detect`, `titleFrom`, `entry`, `openArtifact` (`style`, `store`, `comments`, `exports`, `uses`, `openEarly`). |
| `SKILL.md` | Yes | Authoritative instructions returned to agents when creating/editing an artifact of this type. |
| `reference/` | Yes | Progressive-loading format/craft/workflow docs referenced by `SKILL.md`. |
| `scripts/` | No (gitignored) | Built output copied from `dist/server/` by `npm run build` (`cli.mjs`, `support.js`, `editors/`, `sheets.wasm`, etc.) so the type folder can run standalone. |

## Cross-type composition (`uses`)

Types declaring `"uses": ["design-system"]` in `artifact-type.json` (`slides`, `design`, `data`, `motion`) can install a `design-system` artifact so their editors expose brand tokens, colors, fonts, and (for `design`) mounted component bundles.

## Checklist for adding a new artifact type

1. **Core & Editor packages**:
   - Create `packages/<type>-core` (schema, validation, checks, pure logic testable in `node --test`) and `packages/<type>-editor` (Vite + React editor adopting `@open-artifact/ui` and `@open-artifact/editor-kit`).
2. **Server & Build integration**:
   - Register the type in `packages/type-server` (server routes, actions, scaffold, check/export handlers).
   - Add `<type>: 'packages/<type>-editor'` to `EDITORS` in `scripts/build.mjs`.
   - Ensure `packages/daemon` type discovery and `packages/host` / `packages/host-cloudflare` support the type's storage style if new.
3. **Type skill & manifest**:
   - Create `artifact-types/<type>/artifact-type.json`, `artifact-types/<type>/SKILL.md`, and `artifact-types/<type>/reference/*.md`.
4. **Tests**:
   - Add unit tests in `packages/<type>-core/test/` and `packages/<type>-editor/test/`.
   - Add an E2E suite `e2e/<type>.test.mjs` and test fixture in `test-artifacts/<type>/`.
5. **Documentation sync (mandatory)**:
   - Update `skills/open-artifact/SKILL.md`.
   - Add `docs/types/<type>.md` and `docs/types/<type>.zh-CN.md`.
   - Update `docs/artifact-types.md` & `.zh-CN.md`, `docs/README.md` & `.zh-CN.md`, `README.md` & `README.zh-CN.md`, `plugins/README.md`, and this file.

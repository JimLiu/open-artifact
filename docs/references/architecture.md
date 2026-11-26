# Architecture reference

Load this reference when working across packages, daemon/Shell communication, MCP tools, hooks, hosting, or WASM crates.

## High-level data flow

```text
Agent app (Claude Code, Codex, Cursor, Copilot, Antigravity, ZCode, DSH, Pi, OMP, ChatGPT, or CLI)
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
| `packages/server-sdk` | Shared server primitives and frame-host support used by `type-server` and hosts; `./zip` (`src/zip.ts`) is the one zip reader and writer (archives, type packages, imports: `checkZip`, `unpackZip`, `zipBytes`, `archiveEntries`), which the daemon uses too. |
| `packages/live-store` | Real-time JSON document sync store shared by `whiteboard`, `data`, and `motion`. |
| `packages/harness-kit` | The SDK an agent app builds its adapter on: `createHarness` (connect, start the newest compatible runtime, reconnect, sessions, tools, wakes, pages, `runtime.status()`/`runtime.update()`), `./embed` (Shell embedding in a renderer, no Node), `./testing` (a fake daemon that lists the real daemon's features). See `packages/harness-kit/README.md`. |
| `packages/library-page` | The Open Artifact library page (list, filters, new, rename/pin/delete, update panel, release notes) as a React component a host mounts. Hosts give it their routes and app through interfaces (`PageApi`, `PageHost`, `PageEnv`), map its `--oa-page-*` tokens, and set `theme`/`platform` on its root. `./library` is the DOM-free half (route shapes, changelog parsing). Private, bundled into the DSH plugin's `lib/client.js` and into Open Artifact Desktop's window page (its home tab, with `searchButton`/`createButton` off and `tileGroups` for the blank and agent groups). See `packages/library-page/README.md`. |

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
| `packages/ui` | Shared UI primitives (Base UI + Tailwind CSS), the browser-style `TabStrip` among them; `theme.css` holds the tokens alone for an app that builds only the utilities it uses. |
| `packages/editor-kit` | Shared editor controllers & React views (comments, version history, presence, find, merge, Shell bridge). See `packages/editor-kit/README.md`. |
| `packages/export-kit` | Browser-side export helpers shared by the Slides, Design, Whiteboard and Data editors: DOM capture to pictures and SVG, a rendered document's pages as pictures, measuring and paginating a long document for a PDF, its text layer, font embedding. |
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

### Desktop app

`apps/desktop/` is Open Artifact Desktop, an Electron app with no agent: a sidebar, a tab bar, the library page as
its home tab, one view per artifact tab, a service panel, runtime updates, a settings dialog and a servers switcher.
It is a Harness API host like the examples, built on `@open-artifact/harness-kit`:

- **Runtime**: it carries the built `skills/open-artifact` as `resources/runtime` (`apps/desktop/scripts/build-runtime.ts`)
  and registers it with the kit (`runtime: { dir, version, update: 'prompt' }`); the kit starts the daemon with the
  app's executable and `ELECTRON_RUN_AS_NODE=1`, detached, so no Node.js is installed and the daemon outlives the app.
  Under Electron the daemon runs type servers as processes (`nodeChildren` mode `process`, reason `electron`).
- **Connection**: `createHarness({ harness: 'open-artifact-desktop', embed: { mode: 'view', remote: 'deny' } })`, no
  session and no wake. Each tab asks `harness.view(url)` for a one-time view ticket and loads the Shell's `/a/<id>` in a
  sandboxed `WebContentsView` (no Node, no preload, its own partition); host messages go through the daemon
  (`embedArtifact` with a transport over `shellCommand` and the `shell` events). The token stays in the main process.
- **Navigation**: a view shows only the daemon's origin and the origins `embed.origins` lists (refreshed on
  `embed/origins`); another artifact's `/a/<id>` (Duplicate, Copy as) opens a tab, `/` goes to the first tab, the web
  goes to the system browser, new windows are denied. Permissions are denied except `clipboard-sanitized-write`.
- **Reconnect**: when the daemon goes away the views stay and the bar says it is reconnecting; the kit's reconnect
  runs `ensureDaemon`, so a daemon that was stopped (not only restarted) is started again while the app runs. Once
  connected, each tab without unsaved work is loaded again with a new view (the view's key and the type servers' ports
  belong to the old daemon); a tab with unsaved work is kept as it was and marked for the person to reload (their
  Reload asks first, then lets the page's `beforeunload` go: that work can no longer be saved).
- **Unsaved work** (`apps/desktop/src/main.ts`, on the Shell's `saved` report through `embedArtifact`'s `onSaved`):
  a tab's close (the bar, ⌘W, the Shell's `close`) and the quit (⌘Q, the window's close: `close` and `before-quit` are
  held) wait up to 3 s for the save, then ask in the window's page (`state.ask`, answered over `desktop:answer`; the
  view is hidden meanwhile). A tab with `saved` null is never asked about.
- **Single instance and links** (`apps/desktop/src/links.ts`): `app.requestSingleInstanceLock` on the userData folder
  (so per home in development and test runs); a second start's arguments come as `second-instance`'s
  `additionalData`. `open-artifact://artifact/<id>` is the only link taken (start arguments, `open-url` queued before
  ready, second starts). The app never registers the scheme; a package declares it in `Info.plist` only with
  `OA_DESKTOP_URL_SCHEME=1` (`apps/desktop/scripts/info-plist.ts`).
- **Missing folders**: the Library API's `ArtifactView.folderMissing` (true when the record's `root` is not on disk;
  additive, optional) marks an artifact whose folder went away outside the app. Its tab loads no Shell and offers
  Relocate… (`artifacts.relocate`) and Remove from Library (`artifacts.delete`, which forgets the record only).
- **Service and updates** (`apps/desktop/src/service.ts`, `runtime.ts`): the person's restart, stop and start are
  the kit's `daemon.restart()`, `daemon.stop()` (no reconnecting until `daemon.start()`; `daemon.json` is read every
  1.5 s so a daemon another app started is shown, with Connect) and `daemon.start()`; the apps and editors come from
  the Library API's `harnesses` and `types.servers`, an editor's restart is `types.restart`. Runtime status and Update
  are `harness.runtime.status()`/`update()`; Check, the "check for updates" setting (`runtime policy prompt|bundled`)
  and `doctor` run the carried runtime's command line with the app's executable as Node. Every one runs in the main
  process; the page is sent display data picked field by field, never the token. The library's update offer is the
  shared `UpdatePanel` (`PageUpdates.restart` opens the service panel's restart question).
- **Window page**: `apps/desktop/renderer/` is a React app (bundled by `apps/desktop/build.ts` into
  `out/renderer/`, with `PAGE_CSS` and `UPDATE_CSS` written to `page.css`, and the Tailwind utilities of the
  `packages/ui` components it uses, the tab bar's `TabStrip` and its menus, compiled with no reset from
  `renderer/src/ui.css` into `ui.css`) that draws the sidebar, the tab bar, the
  new dialog, the service panel, the settings dialog and the
  shared `ArtifactsPage` of `packages/library-page`. It talks to the main process only through the preload bridge
  (`window.desktop`); every `ipcMain` handler checks the sender is the window's own page. The page's `PageApi` calls
  go to the main process, which calls the Library API with the daemon's token (`apps/desktop/src/library.ts`, which
  checks ids, the fields of an update, and type ids) and forwards the kit's library events. A new artifact of a
  `BUILTIN_START.blank` type is created with `blank: true` (its editor opens); one of an agent type is created empty
  (the Shell's hand-over prompt). Thumbnails: the main process loads the type's preview page in a hidden offscreen
  window with its own partition and no permissions, takes the `captureRecipe` area as a JPEG, and the page saves it
  at its version; the page shows them through the `oa-thumbnail:` scheme, which the main process answers from the
  daemon. `<userData>/settings.json` keeps the sidebar's fold state, the look (`theme`: system/light/dark), the
  language (`locale`: system/en/zh-CN) and the folder for new artifacts (`artifactsFolder`), set over IPC
  (`desktop:setting`; a folder through the system's dialog). The look is `nativeTheme.themeSource`, so
  `prefers-color-scheme` switches at once in the app's page, every Shell page and every editor frame (the Shell's
  `host_hello.theme` follows `nativeTheme`). The language is Chromium's `--lang`, set before `ready`, so
  `navigator.language` (which the Shell and the editors read) is that language; a changed one takes effect when the
  app is opened again (`restartNeeded`). Sheets' own View-menu theme still comes before the app's look.
- **Menu bar** (`apps/desktop/src/menu.ts`): the macOS application menu, built from a template of named commands
  (New by type, Open Folder… as `artifacts.add`, Import… as `artifacts.import`, Show in Finder, Move To…, Close Tab,
  the Edit items sent to the view in front, Reload, the sidebar, zoom, full screen, previous and next tab, the logs,
  doctor) and built again when the language, the types or the tab in front change. The card's More menu
  (`cardActions` of the library page) and a sidebar row's right-click menu reach the same Show in Finder and Move To…
  (`apps/desktop/src/move.ts`: the app moves the folder, then `artifacts.relocate`; the folder goes back when the
  daemon refuses).
- **Downloads** (`apps/desktop/src/downloads.ts`, `notice.ts`): the views' partition saves to `~/Downloads` with no
  dialog (` (2)` when the name is taken), and cancels a download from anywhere the views may not show; an editor's
  export reaches the app as the Shell's `saved_file`. Both show a notice, a transparent `WebContentsView` of its own
  page above the tab's view, with Show in Finder.
- **Servers** (`apps/desktop/src/servers.ts`, `renderer/src/ServerSwitcher.tsx`): the switcher in the home tab's
  heading (and in Settings, Service and updates) shows the daemon's `remotes` (name, address, account, reachable) and
  `cloud` settings; the app keeps no copy. Adding one is `remotes.add` with `browse: false`, then `remotes.add.wait`
  in a loop (the code and the site's approval page shown in the app, Cancel as `remotes.add.cancel`); an `http://`
  address is asked about first and sent with `insecureHttp`. Choosing one sets only `cloud.settings {default}`; the
  automatic-publishing switch is `cloud.settings {publish: 'auto'|'manual'}`, asked about once when a server first
  becomes the default (`autoPublishAsked` in the app's settings). "This Mac" is a state, not a choice: automatic publishing off, whatever the default (the button shows it then, the
  default's name when publishing is automatic). Removing
  is `remotes.remove` (asked first; `force` offered on a conflict). There is no daemon event for these, so the main
  process reads `remotes` every 3 s while connected (and when the panel opens or a site's page fails): changes made on
  the command line show within that. A published artifact's `/a/<id>` (the daemon's redirect to its site) and a
  site's home page open in a view of a partition of their own (`persist:open-artifact-servers`: no preload, no daemon
  channel, never the token; only the `remotes` origins at the top level, the rest to the system browser); such a tab
  has no saved state or place and closes without asking. When the site cannot be reached, the same tab loads the
  local working copy (editable). An open local tab of an artifact that just got published (nothing unsaved) is loaded
  again so it shows the site's page.
- **Agents' artifacts in the app**: the settings switch "Open agents' artifacts in this app" is the daemon's
  `desktop.settings {openInDesktop}` (`settings.json`, off by default; refused from another origin or inside an
  agent's session). With it on, `HarnessHub.show`'s browser step (a harness whose profile says `open: "browser"`)
  goes first to the connected `open-artifact-desktop` adapter's `host.open` (the app opens a tab: the kit's `open`
  callback); when the app is not connected, `DaemonOptions.launchDesktop` (default `systemLaunchDesktop`: `open
  open-artifact://artifact/<id>` on macOS; `OPEN_ARTIFACT_DESKTOP_LAUNCH=off` turns it off) starts it with the link;
  the browser when neither worked, or the running app declined. A host that shows the page itself (`host.open` of the
  caller) comes first and is unaffected. `Artifact open` answers `opened_in: "desktop"`; doctor's conformance open
  step warns on it. The launcher has unit tests only, no run on a real machine.
- **Profile**: a development build refuses the default home and port 4800 and keeps Electron's folders under
  `<home>/desktop/`; so does a test-mode run of the packaged app. Test mode only: `--locale`, `--theme` (both before
  the settings), `--thumbnails`, `--offline` (every session's requests past this computer refused and listed).
- **Packaging** (`apps/desktop/scripts/package.ts`): a folder-form arm64 `.app`, the code in `app.asar`, the runtime
  in `Contents/Resources/runtime` (found through `process.resourcesPath`), `RunAsNode` left on, signed ad hoc.
- **Artifacts installed as apps** (`apps/desktop/src/installed-apps.ts`, `installed-apps-macos.ts`,
  `artifact-app.ts`, `renderer/src/InstallAppDialog.tsx`): **Install as App…** in a card's More menu (the library
  page's `cardActions`), a sidebar row's and a tab's right-click menu and the File menu opens one dialog (unavailable,
  available, installing, installed, needs repair). An APFS clone of the packaged app in
  `~/Applications/Open Artifact Apps/`, with its own display name, bundle id and type icon and
  `Contents/Resources/artifact-app.json`, signed ad hoc on the outer package; records in `<home>/desktop/apps/`
  (`installing`, `installed`, `uninstalling`, `refreshing`), checked again at every start. Uninstall asks a running app
  to quit through its record (its pid in `running.json`; 15 s, then given up), then the package goes to the Trash,
  `defaults delete <bundle id>` clears its preferences' keys and its `<bundle id>.plist` is removed (Remove Record does
  the same; in test mode only inside the test's own `HOME`). Refresh and repair rebuild beside the old package and swap
  it in with the same install id, bundle id and path; the apps made by another desktop version are refreshed after the
  check at start. A package renamed inside the install folder is claimed (by the desktop app and by the app itself);
  one moved out is not. The build's entry is `src/start.ts`, which runs the single-artifact window when that file is
  there. That app connects as harness `open-artifact-app`, starts the daemon with a desktop app's executable and
  runtime (the record's `templatePath`, another record's, then `/Applications` and `~/Applications`, never those two in
  test mode; its own when none is found), and hands other artifacts and the library to the desktop app; agents' opens
  go to the desktop app only. **The daemon in a package** (`apps/desktop/src/daemon-host.ts`): an app that started the
  daemon from its own package writes `<home>/desktop/daemon-host.json` (valid only while `daemon.json` names that live
  pid); with it, the daemon's entry in `runtimes.json` and its `runtime.status`, the desktop app restarts the daemon
  from its own runtime before an uninstall, refresh or repair moves that package (never while a tab holds unsaved work;
  otherwise nothing is moved and the answer says `daemonInUse`); the refresh at start skips such an app
  (`daemon-in-use`). Both apps restart at start a daemon that lives in an
  installed app's package that is gone (never one whose files are gone anywhere else).
  See `apps/desktop/README.md`.

Desktop sources, preloads, renderer pages, build scripts and tests are TypeScript, checked by the desktop’s own
strict `tsconfig.json`. `src/contracts.ts` defines the page bridges and IPC channel signatures; `src/ipc.ts` and
`src/ipc-client.ts` share them between handlers and preloads. Electron’s untyped transport is confined to those
adapters; sender checks and runtime input validation still run in the main process. Installed-app journals and
states have concrete interfaces and discriminated unions in `src/installed-app-types.ts`.

Desktop packaging (`apps/desktop/scripts/package.ts`) keeps local ad hoc builds and offers `--release` for Developer ID
signing and Apple notarization. `macos-distribution.ts` signs nested code inside out with hardened runtime and JIT
entitlements, staples the accepted app before ZIP creation, checks the extracted package, and separately signs,
notarizes and staples the DMG. `macos-ci-keychain.ts` isolates signing/notary secrets in a temporary keychain with a
real private-key signing probe and explicit cleanup. Desktop and runtime versions agree. `desktop-macos.yml` builds
on native macOS arm64 and tests the signed package; its publisher (`scripts/release.ts`) validates tag/source/signer
and hashes and uploads only public ZIP/DMG/checksums/report/update feed to an independent `desktop-v*` GitHub Release,
preserving existing assets and npm's Latest release. `src/app-update.ts` owns desktop update state and scheduling;
`app-update-feed.ts` validates stable desktop releases and the static Squirrel JSON feed shared with the publisher.
`app-update-electron.ts` uses Chromium networking for GitHub discovery; `app-update-download.ts` streams the ZIP with
real byte progress, verifies size/SHA-256, and hands it through a capability-protected loopback server to Electron's
native updater for integrity/code-signature verification and installation. `desktop.updates` exposes checked,
data-only IPC to Settings and the update window. A button to the right of Settings in the sidebar footer appears only
with an update; clicking starts a download and shows progress. Checks default on (15 seconds after launch, then every
6 hours), downloads default off; the
app's own preferences are independent of runtime policy. Explicit installation passes through the unsaved-work quit
guard; staged updates also install on normal quit. Development, ad hoc and test builds never update. Locally installed
artifact apps keep their ad hoc outer signatures. See `apps/desktop/RELEASING.md` and `RELEASING.zh-CN.md`.

### Website

`website/` is the public website and is not shipped in any package. `site/` prerenders the marketing pages and the docs
(EN/zh-CN) from the repo's markdown. `playground/` runs the real Shell (`packages/shell` sources) and the real prebuilt
editors over an in-memory capability backend with a scripted agent, and the Docs host and Sheets store from
`packages/type-server` are bundled for the browser (`playground/engines/`). Each demo is a static page at
`/playground/<type>/`. See `website/README.md`.

## Agent tools & wake loop

- **Tools** (defined in `packages/protocol/src/tools.ts`, implemented in `packages/daemon/src/tools.ts`):
  - `Artifact`: `quickstart`, `list`, `publish`, `read`, `open`, `call`, `adopt`, `delete`, `share`.
  - `ArtifactData`: `get`, `list`, `query`, `set`, `update`, `delete`, `str_replace`, `batch`.
  - `ArtifactComments`: `read`, `reply`, `resolve`, `reopen`, `wait`.
  - `ShowArtifact` (`packages/daemon/src/mcp-app.ts`): exposed only to MCP clients declaring the `io.modelcontextprotocol/ui` extension. Its view frames the Shell from the daemon's loopback origin (`_meta.ui.csp.frameDomains`) and declares `_meta["openai/ui"].permissions.loopbackNetwork` (`localNetwork` for a private-network origin), so a host that keeps apps on a public origin may let the frame past Chromium's Local Network Access. Codex keeps only https frame domains in a card's CSP, so it refuses the page; the view hears the refusal (`securitypolicyviolation`) and shows a notice with Open in browser and the address to copy at once. It takes the Shell's `shell_hello` as the sign the page showed; when none comes in time, the notice adds Retry. When `ui/open-link` fails or gets no answer, the notice points to the address.
- **CLI parity**: `skills/open-artifact/scripts/open-artifact.mjs` invokes the exact same daemon tool handlers over local HTTP (`artifact`, `data`, `comments`, `open`, `wait`, `mcp`, `hook`). `open-artifact --version` / `-v` prints the runtime's version.
- **Wake routing**: When a user clicks **Send to agent** in the Shell, comments go to the session that owns the artifact: live to a connected Harness API adapter of its harness (`wake.deliver`), else into the daemon inbox, delivered via app-specific hooks (`packages/daemon/harnesses/<name>.json`), background monitors/extensions (`open-artifact watch`, which exits once its parent, or past any shells the first ancestor that is not one, is gone: `lifeline.ts`), the `messages` array in tool responses, or `ArtifactComments {action: "wait"}`. `session.attach` takes the inbox; what an adapter took on a re-attach and could not hand on comes back with `inbox.return` (`Inbox.giveBack`: an open wait takes it, else it waits again ahead of newer messages).

- **What the person typed and selected** (`wake.request.parts`; `normalizeUserText`, `normalizeSelectionSnapshot` and
  `withRequestParts` in `packages/protocol/src/wake.ts`): an editor's `agent.send` may add `userText` (its words) and
  `selectionSnapshot` (the selection at Send, built with `selectionSnapshotOf` in `packages/editor-kit/src/agent.ts`).
  The type server's `normalizeRequest` keeps `userText` only when the request's `text`, after `trimStart`, starts with
  it, and clamps the snapshot (4096 bytes; `text` dropped first, then items). The daemon's `queuePageWake` (the
  `type.wake` route and Link's `wake`) drops `userText` for a type that is not trusted or is remote, and keeps the
  snapshot; `WakeRouter.ask` (the Shell's Ask pane) and the hosted Ask set `userText` to the request's text.
  `wakeMessage` copies both onto `source.requests[]`; the agent's `text` is the same as without them. Design, Slides,
  Design System, Whiteboard, Data and Sheets send them. Docs sends them with a comment: `CommentsCapability.sendToAgent`
  takes `userText` and `selectionSnapshot` (`POST _api/comments/send`; built in
  `packages/docs-editor/src/comments/send-parts.ts`), `DbHost.sendThread` keeps the words only when `threadUserText`
  finds them in the thread's newest message (the sender's, perhaps after an `@agent` mention), and
  `threadRequestText` then starts the request's `text` with them. The page's broker (`packages/runtime/src/broker.ts`)
  passes both on to the Shell, which hands them to the type server as they are.
- **Starting without an agent** (`libraryCall` in `packages/daemon/src/daemon.ts`): `artifacts.create` makes an
  artifact as `open-artifact-home`, then clears `owner` and `createdBy`; it writes only `.artifact.json`, so `bootOf`
  says `empty` (no `detect` file) and `shellBoot` returns before opening the page, and the Shell shows `EmptyArtifact`
  with the hand-over prompt. The type server's `open` writes its type's starting files when the marker is missing
  (`TYPES[type].scaffold` in `packages/type-server/src/server.ts`): `startBlank` opens the page (`openPage`) for that
  and refuses with `unsupported` when the artifact is still empty after it. `artifacts.create { blank: true }` uses it
  (a refused one leaves no record, and no folder that holds only its marker), and so does `artifacts.blank { id }`, the
  Shell's **Start blank** on an empty artifact (its owner stays as it was). `artifacts.open`, `artifacts.preview` and
  `Artifact open` open the page without looking at `empty`, so they write the starting files too. `BUILTIN_START`
  (`packages/protocol/src/library.ts`) is the one list of which built-ins the home page's **New** starts blank
  (`docs`, `sheets`, `whiteboard`, `slides`, `design-system`) and which it makes as before for an agent (`design`, `data`,
  `motion`, `page`; a Page is never empty); the home page (`createGroupOf` in `packages/shell/src/home/model.ts`) and the Shell's
  `EmptyArtifact` read it, and types people make keep their own group. `artifacts.add { folder }` adds an artifact
  folder on this computer through `adoptFolder` (its `.artifact.json`, else a type's marker files; owned by nobody),
  answers a folder the library has already as it is (its owner kept), and refuses with `conflict` a moved folder whose
  `.artifact.json` id is a record whose folder is gone (that one is relocated instead); it does not go through
  `artifacts.adopt`, which records its caller as the owner. `artifacts.relocate { id, folder }` sets a record's `root`
  only when the folder's `.artifact.json` names the same id and no other record has that folder (`conflict`
  otherwise), after closing its page in the old folder. These routes take writes as `artifacts.create` does
  (`writeAllowed`: a JSON `POST` from the daemon's own origin, or the daemon token) and log an `audit:` line.

- **Artifacts no session owns** (`wake.ts`, `ownership.ts`, `inbox.ts`): a wake of an artifact whose `owner` is empty
  (made on the home page, a folder added) is stored in the `unowned` inbox with its `artifactId`, rendered by
  `wakeMessage` with no word on who gets it; `link.ts`'s `tell` stores its notices there the same way. Nothing reads
  that inbox but `WakeRouter.handOff(id, owner, how)`, which runs when a session becomes the owner: `Artifact adopt`
  (`Tools.adopt`, through the `handOff` option), a write through the tools by a session (`Ownership.judge`'s no-owner
  branch: `Artifact publish` with files, an `ArtifactData` write, a type action whose effect is `write`, or
  `agent.wrote`; only a caller with a session id, never `open-artifact-home`, through the `claimed` option), and
  `artifacts.assign`. It writes that artifact's messages to the owner's inbox, all of them (neither `WAKE_PER_MINUTE`
  nor the merge window applies: those are `queue`'s), each wake with `wakeHandOffLine` (`made`, `assigned`, or `gone`
  when the record has a `createdBy`; it ends with `wakeSentLine`, the message's `at` or, without one, that the time is
  not known) before it (`withHandOffLine` adds none to a text that
  has one, and replaces the old "original session is gone" opening an older daemon stored), then takes them out of `unowned` (`Inbox.takeWhere`, which rewrites the file through a rename); both writes
  are one synchronous step, so a message is handed over once, and a process killed between them leaves a copy in both
  rather than none. After `adopt` and tool writes the call's own result carries them (`Tools.call` takes the inbox after
  `afterTool`); after `agent.wrote` and `artifacts.assign`, `WakeRouter.deliverWaiting` sends them one by one as a new wake goes
  (live, else back to the inbox with its own `at`, and a nudge); it takes each out of the inbox (`Inbox.takeFirst`) just
  before sending it, so the session taking its inbox meanwhile gets each once, and a process killed during a send loses
  at most that one. `artifacts.assign { id, session }` takes a session key that `harnesses` lists as live, with a
  session id, refuses an artifact that has an owner (`conflict`) and a session not online (`not_found`),
  and is the person's only: `originRefusal` (the check `types.*` routes use) and any `X-Open-Artifact-Agent` header
  answer 403 `not_granted`; it logs an `audit:` line. The Shell's Ask pane (`AssignBox` in `AskPane.tsx`, with
  `assignableSessions` and `takeOverText` in `shell/model.ts`) lists the live sessions for an artifact no session
  owns, or, with none online, the prompt to copy. Opening, editing or commenting from the Shell or the home page never
  changes an owner.

- **Where a new artifact goes** (`Tools.place` in `packages/daemon/src/tools.ts`, `project.ts`, `settings.ts`,
  `config.ts`): a `publish` that names no `folder` is placed by `artifactsLocation`, `home`
  (`<homeWorkspace>/<project>/<slug>`) or `workspace` (`<workspace>/<artifactsDir>/<slug>`). Highest first: the call's
  `folder`, then its `location`; a confined daemon (always the workspace; `location: "home"` is `not_granted`); the
  person's `projects[<project>]` entry in `settings.json`; the project's own
  `<project>/.agents/open-artifact/settings.json` (`PROJECT_SETTINGS_FILE`; only `PROJECT_SETTINGS_KEYS`,
  `artifactsLocation` and a relative `artifactsDir` that stays inside, are read, every other key is ignored since a
  repository is untrusted); the person's `artifactsLocation`; the harness profile's `policy.artifacts` (`workspace` in
  every shipped profile but `pi` and `omp`); `home`. `artifactsPlacement` reads the files on each call and reports each value's
  source. `projectOf(workspace)` walks up to the top of the Git checkout (never past it, never to the home folder,
  never taking the person's own settings file for a project's): the nearest settings file's folder is the project,
  else the checkout's top, else the workspace; a linked worktree (`.git` file with a `commondir`) has the main working
  tree's identity, read from the files without running `git`. `homeProjectDir` names the project's folder after it
  and marks it with `.open-artifact-project.json`; a taken name gets 4, 8 or 16 hex digits of the path's sha256. The
  record keeps `project` (`ArtifactRecord.project`, never in `.artifact.json`), and "this project's artifacts" in
  `list`, `quickstart`'s `existing` and `related` are the records of the caller's project or under its workspace.
  The Library API hands the project on as `ArtifactView.project`. Both lists show and filter by it with the protocol's
  `projectChoices` and `projectName`: the daemon's home page (`packages/shell/src/home`: a chip on each card, a row of
  projects above the grid, and `forHost` counting an artifact made for the host workspace's project as the workspace's)
  and the library page (`packages/library-page`: `PageArtifact.project`, `Filters.projects`, the filter menu's Project
  submenu, the search), which Desktop and the DSH plugin mount.
  When the location came from the harness default and the daemon makes `<workspace>/<artifactsDir>/` in a Git checkout,
  it writes a `.gitignore` (`*`) there. A `root` outside the caller's workspace adds a note to the create result (the
  agent may send files with `publish`'s `files`). `open-artifact config [list] | get | set | unset [--project | --local]`
  reads locally (`configList`) and writes through the Library route `config.set` (`configSet`: the person's file, the
  project's file, or the person's `projects` entry), which refuses another origin and an agent's session (`personOnly`
  `config-set`) and is logged as an `audit:` line. `OPEN_ARTIFACT_HOME_WORKSPACE` names `homeWorkspace` when the file
  does not (the tests use it: `scripts/test-env.mjs`, `packages/daemon/test/helpers.ts`, `e2e/run.mjs`).
  `doctor-location.ts` reports the location in effect and its source for a harness and a folder, warns when it is
  `home` for an app in its `WRITABLE` table (the apps measured to keep their agent to the working folder) unless the
  app's own settings already allow the folder, and names a project file's ignored keys and `projects` entries whose
  folder is gone; it reads only. User docs: `docs/settings.md`.
- **Workspace confinement** (`OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1`, `startDaemon({ workspaceFoldersOnly })`, for an
  app that sandboxes its agents): `WorkspaceDirectory` (`packages/protocol/src/workspace-files.ts`) pins a folder by
  real path, device and inode and resolves a path through the real path of its nearest existing parent (a link leading
  out, or a replaced folder, is `not_granted` 403); `readJson`/`writeJson` go through it, the write by a random
  temporary name made with `wx`. `ArtifactStore.create` records `workspaceDirectory` (the caller workspace's identity)
  and `authorizedRoot(record)` resolves the folder through it; the daemon uses that for type-server calls, the static
  page's `/_root/`, zips and `setCapabilities`, and passes the identity in `OpenRequest.workspaceDirectory`, so the
  type server (`server-sdk` `Mounted.workspace`, `requireAuthorized`) and its stores (docs, sheets, uploads, snapshots,
  the frame db's `imports` for `file_path`) refuse the same. In `tools.ts`: `workspaceDirectory(caller)` (a caller with
  no workspace is refused), `artifactFiles(record, caller)` for publish/read, `resolveFolder` and `adopt` keep folders
  in the workspace, `pathOutside` refuses an action's argument path that leads out of it (a path counts when its top
  folder exists), `dataToFile` writes `out_file` inside it, and `reachable` limits `list` (`scope: "all"` too),
  `similarTo` and `relatedTo` to it. `inFolder` makes an artifact at a workspace's top count as the workspace's (in
  every mode). A refused precondition (`if_match` conflict) carries `executionStatus: "not_executed"`, set by the
  dispatcher only (an action's own is removed). Tested in `e2e/workspace-confinement.test.mjs`.

- **Types people make**: `open-artifact types new | check | from | enable | disable | trust | untrust | list` and the
  Library routes `types.new`, `types.check`, `types.from`, `types.enable`, `types.disable`, `types.trust`
  (`packages/daemon/src/type-authoring.ts`). The routes refuse any `Origin` but the daemon's own (`http://<one of its
  hosts>`), even with the token, and a cross-site `Sec-Fetch-Site`; `types.enable`, `types.disable` and `types.trust`
  also refuse a call that says it comes from an agent's session (`X-Open-Artifact-Agent`), and the CLI refuses them
  there (`personOnly`, `type-enable`/`type-disable`/`type-trust`/`type-untrust`). Each change is logged as an
  `audit:` line, reloads the settings and broadcasts `types/changed`. The `types` route's `projects` lists the types of
  known project folders (session workspaces, trusted projects, the home workspace, projects a type was made in) for
  the home page's Types tab. `type.icon` is a Library read: `api()` sends every other `type.*` name to the Type API.
  `types.from` takes `{artifact}` (a page artifact) or, with the token only, `{path}` (an absolute path to a page saved
  from claude.ai, `typeFromSaved`: `stripFrameRuntime`, `withInferredCapabilities` from `capabilitiesUsed`,
  `metadata.json` read as untrusted one-line text, `SKILL.md` from the `notes-for-claude` block via `pageNotes`).

- **Restarts**: `open-artifact daemon restart` (refused in an agent's session, `personOnly` `daemon-restart`) and the
  kit's `restartDaemon` / `Harness.daemon.restart()` stop a daemon that answers its health check (`replaceDaemon`),
  wait for its process and start another (`ensureDaemon`); `HarnessClient.across` holds the kit's reconnects meanwhile.
  `Harness.daemon.stop()` (the kit's `stopDaemon`, also under `restartDaemon`) stops it the same way and then
  `HarnessClient.halt` keeps that harness from starting it again (no reconnect; a call that would connect fails with
  `disconnected`; the state is `stopped`) until `daemon.start()`, `daemon.restart()` or `ready()`; its answer lists the
  other connections (`harnesses` adapters) because their kits, with `autoStart`, start the daemon again.
  The Library routes `types.servers` (the running type servers and their state) and `types.restart` (`{id}`: stop one;
  the next page open starts it again) are for the person's app: `types.restart` takes a JSON `POST` from the daemon's
  own origin or the token, refuses another origin and `X-Open-Artifact-Agent` with 403 `not_granted`, and logs an
  `audit:` line.

- **Type packages** (`packages/protocol/src/type-package.ts` for the rules, `packages/daemon/src/type-packages.ts`,
  `packages/daemon/src/artifact-import.ts`): `types pack` (in the CLI process: `types check --for-share`, then
  `zipBytes`), `types install | update | uninstall` and `import` (through the daemon's routes `types.preview`,
  `types.install`, `types.update`, `types.uninstall`, `artifacts.import`, so each is an `audit:` line). A preview reads
  and checks the whole package (`checkZip`, `packageEntryProblems`, `manifestPackageProblems`, the declaration with
  `readStaticDeclaration`) and stages the bytes by sha256 in `<home>/types-staging`; install takes `{sha256}` and
  unpacks exactly those bytes into a dot folder of `<home>/types/` (`OPEN_ARTIFACT_INSTALLED_TYPES`), checks the
  unpacked tree again and renames it into place; `<home>/types.json` records `uid`, `source`, `version`, `sha256`.
  The registry's `installed` root sits between `extra` and `builtin`, is never trusted (`TypeInfo.ownCode` with an
  untrusted root is refused in `servers.ts`; `untrustedEntryRefused` in `types.ts` drops an installed manifest's
  `entry` and an untrusted project's `entry.url`) and never takes a built-in id. Unpacked files are written `0644`.
  The routes go through `typesRefusal` (own origin only, no cross-site; install, update and uninstall refused with
  `X-Open-Artifact-Agent`). Restrictions follow `TypeInfo.trusted`, not scope: frame-host gets
  `OPEN_ARTIFACT_TYPE_SCOPE` and `OPEN_ARTIFACT_TYPE_RESTRICTED` (`stampOf` includes `trusted`, so trusting a project
  restarts it); when restricted it sets `installedTypeCsp(network)` on every content-origin response and its session
  answers `sandbox: RESTRICTED_FRAME_SANDBOX`, which the outer page sets on the inner frame. The daemon does the same
  for a restricted static type in `staticEntry`, puts `sandbox` in `ShellBoot` for the Shell's `Stage` frame and sends
  `frame-src http://*.frame.localhost:<port>` on that Shell page. `restrictedTypeNotice` gives the type's
  `third_party_notice`; reads of such an artifact add `PAGE_CONTENT_NOTICE` (`pageContentFields` in `tools.ts`).
  Links out of a folder are neither served nor written through (`realInside` in `paths.ts`, `staysInside` in the
  server-sdk's `frame/files.ts`, used by publish, db, assets, comments and `artifact-type/`; the stores take it as
  `LINK_GUARD`, a host without links passes `PLAIN_GUARD`). Artifacts record `typeUid` (and `typeSource`) in the record and `.artifact.json`;
  `typeMismatch` refuses open and writes, and `readArtifactArchive` finds an import's type by that uid. A static type's
  `artifact.archive` is zipped by the daemon (`archiveEntries`); frame-host answers `/__open-artifact/archive` itself.

- **Page artifacts**: `Artifact publish` takes `capabilities` for a `page` artifact only (omitted keeps, `{}` clears,
  an object is the whole set), kept in the record (`ArtifactRecord.capabilities`) and `.artifact.json`; frame-host in
  page mode grants exactly those (plus `artifact` and `permissions`). The frame runtime defines `window.claude` as a
  read-only alias of `window.openArtifact` unless the page already has one. `LinkHub` publishes a page only to a site
  whose `hello` says `features.pages` (`PAGE_NO_SITE` otherwise; custom static and page-style types stay
  `CUSTOM_NO_SITE`; a custom frame type, `isSiteKindType`, goes to a site whose catalog has it: see Site types). The declaration does not travel with files (`.artifact.json` is not `linkSynced`): after a
  publish the daemon sends a changed one by `link.capabilities`, and takes the owner's change on the site from the
  `artifact` event's `capabilities`; `ArtifactRemote.capabilities` is the last agreed one, so neither side echoes.

- **Page artifacts on the Node site** (`packages/host/src/node/frames.ts`, `core/page-host.ts`): the rooms send
  `/page/…` on an artifact's content host (the inner shell and its API, under the viewer's page token) and every page
  host (`<idlabel>--<opaque>`, the page's files) to a frame engine, everything else to the type server. The engine
  runs one `FrameCore` per artifact with a site `FrameEnv`: the viewer from the page token and the live role
  (viewer→`view`, commenter→`view`+comments, editor→`admin`, owner→`owner`; guests marked), `withholdIdentity`,
  `restricted`, no watcher (Link pushes and the site MCP's writes call `noteChanges`), `people()` the owner and user
  grants, the network policy of `OA_PAGE_NETWORK` (`installedTypeCsp`), wakes and touches through the rooms' type API
  (the outbox, as built-in types). The opaque part is an HMAC of the signing key over artifact, principal and site
  epoch (24 base32 characters); an index under `<dataDir>/page-hosts/` maps it back, and every request checks the HMAC
  and the live role again. `hostKindOf` names page hosts (`kind: "page"`), TLS ask allows only placed ones, and with
  `OA_CONTENT_SAME_SITE` the engine is off. The site MCP's `publish` takes `capabilities` for a page (owner only);
  `link.import` and library uploads take a page by its `.artifact.json` (`importArchive`'s `markerTypes`).

- **Site types** (`packages/host/src/core/catalog/site-types.ts`, `core/link/types-routes.ts`,
  `packages/host/src/node/site-types.ts`): migration 10 adds the `types` table (uid primary key, id unique, version,
  publisher, visibility, sha256, capabilities, network, `unpublished`). `SiteTypes` holds the rules, pure over a
  `SqlDriver` (`plan`: built-in, reserved and taken ids, uid and version shape, who manages it, same version other bytes;
  `mayPublishTypes` for `OA_TYPES_PUBLISH`, forced `off` with `OA_CONTENT_SAME_SITE`; `mayListSiteType` /
  `mayDownloadSiteType` for visibility; unpublish delists while `artifactCount` > 0, else removes). The Link routes
  `types.import` (policy, `SiteTypeServices.read`, `plan`, the `type.publish` guard, `store`, `save`, `activated`, the
  old version's files removed, audit), `types.list` (with `THIRD_PARTY_NOTICE`), `types.archive` and `types.unpublish`
  are registered only with `LinkServices.siteTypes`; `hello` then says `features.types` and `typesPublish`. The Node
  side reads a package with the server-sdk's `checkTypePackage` (the daemon's install check), keeps only page-kind
  types (no `entry`, not `style: "page"`, a declaration), unpacks it `0644` into
  `<dataDir>/types/<uid>/<version>/files/` with `package.oatype` beside it, and gives the frame engine one
  `SwappableSource` per id (`withSiteTypes`; fingerprint `uid@version:sha`): `FrameEngine.typeChanged` updates the CSP
  (`installedTypeCsp(row.network)`, never `OA_PAGE_NETWORK`) and reloads open pages. A catalog artifact runs restricted
  under `/page/` (`rooms.pageFor`), with its type's declared capabilities. Imports (`importInto`, `siteTypeImport`)
  take a catalog type by `.artifact.json` `type` plus `typeUid` (`type_missing`, `type_mismatch`; a delisted type
  takes no new artifact). The site MCP adds `third_party_notice` (`THIRD_PARTY_NOTICE` + `PAGE_CONTENT_NOTICE`) to
  results about such an artifact (`McpServices.publishedType`). The daemon: `isSiteKindType`, `typePublishRefusal`
  (user, extra and trusted-project types only), `packTypeBytes`, `LinkHub.publishType` / `unpublishType` and
  `publish(…, {withType})` (the type first with `link` visibility when the site lacks it), the Library routes
  `types.publish` / `types.unpublish` (refused with `X-Open-Artifact-Agent` in `typesRefusal`, as is
  `artifacts.publish {withType}`); automatic publishing skips custom site-kind types.
  On the app origin (`core/app/site-types.ts`; `siteTypeRoutes(router)` is mounted by the platform beside the Link API, the Node host's only with `link.siteTypes`, and reads `AppServices.siteTypes`): `GET types` / `type` /
  `types.package` and `POST types.update` / `types.unpublish` (`SITE_TYPE_ROUTES`), and the type page `GET /t/:id`
  (the home bundle with `HomeBoot.typePage`; `isPagePath` covers `/t`). `seeSiteType` is the one gate: download rules,
  anonymous only for `link` with `publicAccess`, else `noSiteType` (401 signed out, the same 404 body otherwise; the
  page turns the 401 into a sign-in redirect). Widening visibility needs `typesPublishRefusal === null`; audited
  `type.visibility`. `unpublishSiteType` and `siteTypePackageResponse` (zip, attachment, nosniff, no-store,
  `TYPE_PUBLISHER_HEADER`) are shared with the Link routes. `SiteTypeServices.skill` reads the SKILL.md the manifest
  names (`SITE_TYPE_SKILL_MAX`). The site MCP (`core/mcp/tools.ts`, `McpServices.siteTypes`: `skill`, `scaffold`)
  lists the listable, non-delisted catalog types that do not shadow a built-in one (`source: "site"`,
  `published_by`, `third_party_notice`), creates them (`scaffold` writes `.artifact.json` with `typeUid` and
  `typeSource`; instructions = notice + SKILL.md) and refuses a delisted one (`not_granted` to managers,
  `type_missing` otherwise); its initialize prompt names built-in types only. The Shell home (`lib/site-types.ts`,
  `home/components/SiteTypes.tsx`) draws the Types tab (`cloud.siteTypes`) and the type page as text. The daemon
  installs from `https://<site>/t/<id>` (`siteTypePageOf`): `LinkHub.siteTypePackage` uses the remote of that exact
  origin (`LinkClient.typesArchive`), else the public `types.package` address without credentials
  (`fetchTypePackageAnswer`); 401/403/404 become `unauthorized` / `not_granted` / `not_found` with the fix, the
  preview carries `site {origin, publisher, remote}`, and the page's address is the recorded source that
  `types.update` reads again. To someone signed out, a publisher named by an email address is not named
  (`publisherNameFor`).
  `GET types.sites [?remote=]` (daemon Library only; no MCP tool or CLI command) lists each signed-in remote's
  `types.list` through `LinkHub.siteTypeLists`: remotes in parallel, each with its own deadline
  (`OPEN_ARTIFACT_SITE_TYPES_MS`, default 5 s) and its own `error` + `code` (`unreachable`, `timeout`, `signed_out`,
  `unsupported`, `refused`, `error`), delisted types dropped, fields capped and made plain text (`siteTypeListed`), the
  page built from the remote's origin (`<origin>/t/<id>`), nothing cached. `siteTypeStanding` matches by uid:
  `published-here` (a non-installed local with that uid), `installed` (an install with that uid and the listed
  sha256), `update` (an install with that uid, other bytes), `clash` (a different uid holds the id), else `new`. Agents
  may read it as they may `types.preview` (`typesRefusal`: origin and cross-site checks); the answer always carries
  `THIRD_PARTY_NOTICE`. The Shell home (`lib/connected-site-types.ts`, `home/components/ConnectedSiteTypes.tsx`)
  reads it when the Types tab mounts and installs through `InstallTypeDialog` (`types.preview {url}`, then
  `types.install`).
  The Cloudflare host keeps the catalog too (`packages/host-cloudflare/src/site-types.ts`): `SiteTypeServices` over D1
  (`type_packages`, `type_package_chunks`: 768 KiB chunks, 16 MiB a package, a version served only once `complete`),
  made on first use; an artifact's object copies its type's served files into its own SQLite (`catalogFrameTypes`,
  keyed `uid@version:sha`, a second `RoomFrameTypes` source after `bundledFrameTypes`); a changed row reaches rooms
  through the hub (`/types/watch`, `/types/changed` → the room call `type-changed`), with the room's own row check as
  the fallback (2 s per request, 30 s while pages are connected). While the site runs pages (`site.pages`, never under
  `OA_CONTENT_SAME_SITE`) it registers its own `GET types.package` before `siteTypeRoutes` (the package streamed from
  D1: `HEAD` from the `type_packages` head row, `GET` `READ_BATCH` chunks per query through a `FixedLengthStream`, the
  sha256 checked before the last chunk is sent) and passes `AppServices.siteTypes` and `McpServices.siteTypes`: `skill`
  reads the `type_skills` row kept when the version is stored (an older version's is read from its package once, then
  kept), and `scaffold` asks the artifact's room (`RoomClient.create` with `typeUid` and `typeSource`) to write the
  marker `scaffoldArtifact` writes. `mcpDispatch` reads the rows again for each `POST /mcp` (`publishedTypes(true)`,
  for the synchronous `publishedType`). The `core/` routes, page and MCP code are platform-neutral.

- **The frame core** (`packages/server-sdk/src/frame/`): `core.ts` (`FrameCore`, `mountFrameCore`) serves one
  artifact to any number of viewers from plain data (`FrameRequest` → `FrameReply`; `connect` for an event
  connection) and takes everything about where it runs from a `FrameEnv` (`env.ts`): the viewer of each request, the
  shell and page origins, admission, the type's files, the client files, the change watcher (null: every write goes
  through the core, a host's own writes come in by `noteChanges`), restricted or not, and the stores' `PathGuard`.
  A restricted page whose origin is one the inner shell uses is refused at mount (`same_origin`). `local.ts` is
  frame-host's environment (`localFrameEnv`: loopback admission, the owner as every viewer, the type folder,
  `CLIENT_DIR`, `fs.watch`) and its Node HTTP adapter (`FrameSite`, `mountFrameSite`); `core.ts` imports no Node-only
  module (`test/frame-env.test.ts` walks its import graph).
  The `snapshot` action of page-kind types is local too: `frame/snapshot-action.ts` (`localFrameActions`, what
  frame-host passes; the core's `frameActions`, which a hosted site serves, has no `snapshot`) and the camera
  `src/snapshot.ts` (headless Chrome over CDP, shared with `type-server`, which re-exports it). The camera loads the
  inner shell at `/snapshot/<one-time credential>/` (`FrameSite.beginSnapshot`, claimed only while the visit lasts):
  a viewer of its own with the owner's level whose calls pass a read list (`SNAPSHOT_READS`) and are refused
  otherwise, with a quiet event stream (`hello` only, never the core's `connect()`: no peer, no reload). The shell
  marks `<html data-open-artifact-shell="revealed|problem">`, which is what the camera waits for. Pictures go to
  `<root>/_agent/snapshots/`, which is never served, archived, duplicated, synced or counted as content.

- **Enforcement in the frame core**: every call is checked on the server against the request's `FrameViewer` (its
  `level`, `view < interact < admin < owner`, and `canComment`), never against what the page or the inner shell
  says. `access.ts` holds the rules as pure functions (`test/frame-levels.test.ts` runs every level against every
  rule kind); `core.ts` applies them (`test/frame-site.test.ts` runs several viewers on one instance):
  - `db`: the declaration's `rules` (`{path, read?, write?}`; `{self}` subtrees; the `self` level nobody holds; the
    built-in `data/users/{self}`, so another viewer's `data/users/<id>/` is private, the owner's view included, unless a
    rule at `data/users`, or a rule at `data` beside `data/{self}` (`data/users` is then a sibling's subtree), opens it). With
    no rules, `view` reads and `interact` writes. A refused read looks like a missing document (`get`, `query`, whose
    limit counts only readable rows), a refused write is `invalid_argument`, and change events reach a connection
    only for paths its viewer may read. A lease's holder is the viewer's id plus the page's string; a busy answer
    names the holder only when it is the viewer's own (another tab). Rules that break the grammar fail closed (only the owner reads or writes).
  - `artifact` publish, sync and edit: `admin` and up (`not_writer`); on a site `{artifact: {publish: false}}` makes
    them `not_granted` for everyone (locally the declaration is not read for it, as before). The `title` and
    `agent`/`activity` routes follow the same levels.
  - `assets`: granted at `admin`, or at `interact` with `{assets: {upload: "interact"}}`, checked before an upload's
    body is read; the blob's metadata records its `uploaders` (the same bytes from two people are one asset both
    claim; older metadata's single `uploader` reads as one claim, none as the owner's). Below `admin` a viewer lists
    only what it claims and deletes only its claim (`not_uploader` without one), the bytes going with the last claim;
    an editor's delete removes the asset.
  - `comments`: granted only with `canComment`, authored as the viewer; resolve, move and delete need the thread's
    starter or an editor (`forbidden`); comment events and counts go only to viewers who may comment. On a site the
    threads a page gets (`list` and every answer that carries a thread) name an author only under the `profile` scope
    and carry its `principal` only when `user` is declared; the viewer's own messages carry `author.mine`. The inner
    shell's own comments UI marks its calls `shell: true` in the `/api/frame/cap` envelope (a call it relays from the
    page never does) and gets the threads as stored.
  - `user`: where `FrameEnv.withholdIdentity` (a site), name and avatar only under the `profile` scope, email only
    under `email` (in `session.me` too); `profiles`, `search` (only under `profile`, for a viewer who edits or
    comments) and `access` answer only about `FrameEnv.people()`. Locally as before: names, no email, an empty search.
  - `room`: on a site, `from` (and the publish echo's) is the viewer's own connection (a client id that is not one
    sends nothing; locally the id as given, as before); on a site `by` only
    when `user` is declared and names only under `profile`; topics are `admin`-only unless
    `capabilities.room.topics` opens one to `interact` (`not_permitted`).
  - The owner's agent (`comments.sendToAgent`, `room.sendToAgentSession`, `/agent`): an editor who may comment.
  - Origins: the page's origin answers from `FrameEnv.reader` (the page's own read-only token, never the viewer's;
    `GET`/`HEAD` of files only), and a viewer marked `readOnly` is refused on every inner-shell route, the event
    stream and WebSocket included; `/_blob/<id>` on the inner shell's origin is served only once admitted; both
    origins send `Referrer-Policy: no-referrer` (the page frame keeps `referrerpolicy="origin"`, so the page origin
    still sees who framed it). `FrameEnv.pageOrigin(viewer)` is the origin the inner shell frames
    the page on (`session.contentOrigin`): a site puts the page's read-only token in it as a host label and resolves
    the reader from `Host`, since the page's own addresses are root-relative; the session refuses one that is a shell
    origin.

  On this computer the one viewer is the owner and may comment, its reader is the owner, its people are itself, and
  identity is not withheld, so what a page can do here is unchanged.

## Live document sync (`db`)

`whiteboard`, `data` and `motion` pages edit `<root>/db/` through the runtime's `db` capability
(`packages/runtime/src/capabilities.ts`), synced by `@open-artifact/live-store` (`packages/live-store/src/engine.ts`):
what the page shows is the server's documents with the page's own unsaved and unanswered writes on top.

- **Order**: the type server's `DbHost` (`packages/type-server/src/db-host.ts`) keeps `{epoch, seq}`: a random epoch per
  instance, and `seq` counts its change events. Events carry it; so do write answers (`{epoch, seq, documents}`, each
  written document as stored, `null` when absent) and listings (`db.listing(collection)`: `{epoch, seq, documents}`).
  The engine keeps, per document, the newest `seq` it has taken and ignores anything older. Events arrive in order on
  one stream; a write answer or a listing can arrive before or after events about older or newer changes, and the
  `seq` sorts them out (a deleted document is not brought back, an agent's edit merged into a write shows at once).
- **Reconnects**: every event stream starts with a `db` event `{changes: {}, resync: true, epoch, seq}`. When the
  events heard or the listings already reach that `seq`, nothing was missed; otherwise (or on a new epoch, after a
  restart) the engine lists the collections again in the background, with editing still open.
- A store without an order (a plain `DbCapability` with no `epoch`/`seq`) still works: write answers are then held
  over later events for a few seconds, as before.
- A Shell can outlive a daemon upgrade (it frames the page across reconnects), so a new page may talk to an older
  broker that does not know `db.listing` and refuses it as `invalid`. The engine then asks `list` instead and keeps to
  it (`listCollection` in `engine.ts`; `e2e/shell-save.test.mjs` (c)).
- Whiteboard inks are ordered by `at`; `addInk` stamps one past the newest so a page with a slow clock still lands last.

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
| `harness-embed.ts`, `harness-view.ts` | Declared host origins and view tickets for top-level views; `view.open` (this daemon's own artifacts only, `localArtifactIdOf`; no session); `view.context` for the owner session. |
| `ownership.ts`, `release-guard.ts` | Which session owns an artifact (and when that moves); artifacts written by a newer type release are read-only. |
| `runtime.ts`, `cli-runtime.ts`, `sea.ts` | Runtimes on this computer, update policy and checked updates, `open-artifact runtime …`; the single executable's entry (`scripts/build-sea.mjs`). |
| `doctor.ts`, `doctor-checks.ts`, `doctor-location.ts`, `doctor-remote.ts`, `doctor-conformance.ts` | `open-artifact doctor`: setup checks (including `node-children`, how type servers run), where artifacts go (`home-workspace`, `artifacts-location`, `project-settings`, `settings-projects`, for `--workspace` or the current folder), remote-type probes, and with `--session` the conformance run of a running app. |
| `servers.ts`, `node-children.ts` | Type servers: start, ready, restart on a type change, idle stop. A server whose command is `node` runs as a child process (the daemon's executable with `ELECTRON_RUN_AS_NODE=1`) or, when the daemon runs inside an Electron process (`process.type` set, as in a utility process, which an app with the `RunAsNode` fuse off uses), in a worker thread of the daemon; decided from how the daemon runs, nothing is started to find out. `OPEN_ARTIFACT_NODE_CHILDREN=process\|threads` forces one; the choice is in `/__open-artifact/health` as `nodeChildren`. |

The kit (`packages/harness-kit/src/`) mirrors this from the app side: `harness.ts` (`createHarness`), `client.ts`
(the JSON-RPC client), `runtimes.ts` (which runtime to start), `daemon.ts` (`ensureDaemon`; a host's `daemon.spawn` starts
the process itself, as an Electron app does with `utilityProcess.fork`), `skill.ts`, `context.ts`, `embed/` and `testing.ts`.
Shell-side, `packages/shell/src/shell/bridge.ts`, `view-channel.ts` and `lib/host-origins.ts` speak the host messages
of `packages/protocol/src/shell.ts`. `bridge.ts` relays the page's `saved` and `leaveLosesWork` to the host as `saved`
(deduplicated, `null` while a page loads); `caps.switcher` (`offersSwitch` in `shell/model.ts`) drops the title menu's
Switch artifact.

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

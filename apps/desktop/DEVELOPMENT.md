# Desktop TypeScript development

[简体中文](DEVELOPMENT.zh-CN.md)

The desktop app owns its dependencies and lock file. It is outside the root npm workspace, so root typechecking
and unit tests do not check it. Node.js 22.18+ is required.

For daily development, run this at the repository root:

```bash
npm run desktop
```

`scripts/dev-desktop.mjs` installs missing workspace/Desktop dependencies and the Electron binary, then always runs
the root build, skill build and Desktop build before launching. The daemon uses this checkout's carried runtime,
even if another installed runtime has the same or a newer version: the development profile's `runtime.pin` follows
the checkout's version, and runtime downloads are disabled for this run.

- React components use Vite + React Fast Refresh (preserving state when supported); CSS updates in place. Shared UI
  and library page sources are included. Vite listens only on `127.0.0.1`, starting at port 5173 and trying the next
  available port when needed.
- Main-process, preload, standalone notice/status page and main-process library dependencies rebuild and restart
  Electron. Daemon, Shell, editor, artifact-type and other runtime inputs rebuild the runtime too, then stop the
  development daemon and restart with the freshly copied files, including changes at the same version number.
- The default persistent profile is `<repo>/.desktop-dev/` (gitignored), with daemon port 4890. Use
  `npm run desktop -- --home /tmp/oa-desktop --port 4891` to choose another. The default home and port 4800 are refused.
  One launcher may own a profile at a time. Other Electron app options, such as `--open <id>`, are forwarded.
- Build failures leave the running app available and retry on the next save. Restarts use the normal unsaved-work
  quit guard; cancelling keeps the app running. Save and edit again to retry. Closing Desktop or pressing Ctrl+C
  stops the watcher, Vite and the development daemon. The profile and artifacts are kept.

After changing dependencies, the Vite config or the launcher itself, rerun the command (install changed dependencies
with `npm ci` at the root or in `apps/desktop` as appropriate). Rust source changes still need `node scripts/build-wasm.mjs`;
the generated WASM changes are watched. Artifact editors and the Shell use rebuild/restart rather than React Fast Refresh.

For a manual build and the desktop checks, build the runtime before setting up the desktop app:

```bash
npm run build
node scripts/build-skill.mjs
cd apps/desktop
npm run setup
npm run check
```

- `npm run typecheck` checks all authored TypeScript: the main process, three sandbox preloads, React renderer,
  standalone notice/status pages, build and packaging scripts, test helpers, development tests and packaged tests.
- `npm test` rebuilds the app and runs development tests sequentially. Each test uses an isolated profile and port.
- `npm run check` runs the strict typecheck followed by `npm test`.
- `npm run package` builds and signs the local macOS app; run `npm run test:packaged` after packaging finishes.
- `npm run package:release` creates Developer ID signed, notarized ZIP / DMG files; `npm run test:release` checks
  release validation without Apple credentials. See [signing and GitHub Actions releases](RELEASING.md).

`tsconfig.json` includes `vite.config.ts`, inherits strict workspace settings and enables `erasableSyntaxOnly`. Node runs `.ts` scripts and tests
directly. Source imports use `.ts` / `.tsx`. Esbuild emits the main entry as `out/main.mjs`, sandbox preloads as
`out/*.cjs`, and renderer scripts as browser `.js`; Electron loads only those generated files. `out/`, `resources/`
and `dist/` are generated and excluded from typechecking.

`src/contracts.ts` is the shared contract for `window.desktop`, `window.artifactApp`, `window.notice` and request/response
IPC channels. `src/ipc.ts` checks main-process handler signatures and verifies the sender; `src/ipc-client.ts` confines
Electron's untyped request transport to one adapter. Pages declare their globals in `renderer/globals.d.ts`.
`src/installed-app-types.ts` models the install journal, native operations and discriminated installation states.
Test CDP commands and events use `devtools-protocol`'s protocol map.

Desktop application updates use `src/app-update.ts` (state/schedule), `app-update-feed.ts` (GitHub desktop tags and
static Squirrel metadata) and `app-update-electron.ts` (Chromium networking/native updater). The `desktop.updates`
bridge exposes `get()`, `onChange()` and `do(check|download|cancel|install|checking|auto-download|notes, on?)`; preference
actions require a boolean. `appAutoCheck` defaults true and `appAutoDownload` false in the app settings, independently
of runtime updates. The release publisher validates the feed against the notarized ZIP. Development/ad hoc/test
builds cannot check or install; tests inject dependencies into the state controller, use fake timers and exercise the
disabled real Electron bridge. Restart installation reuses the existing unsaved-work quit guard.

`app-update-download.ts` streams the remote ZIP to a private temporary cache, counts written bytes (progress events
at most every 100 ms), verifies size/SHA-256, and serves a per-download capability feed and ZIP on 127.0.0.1 for native
signature verification/staging. Cancellation removes partial files; handoff/quit cleanup closes connections and
removes the temporary cache. The sidebar button appears only with a known newer version and opens `AppUpdateDialog`;
the window can close while a download continues. Cancellation is offered during remote transfer, before native staging.

Add concrete fields and state variants to these contracts when extending the app. Preserve runtime checks for
IPC arguments and data read from disk or subprocesses; `unknown` belongs at those input boundaries and in generic
helpers. Do not replace application models with `any`, catch-all dynamic aliases or TypeScript suppression comments.

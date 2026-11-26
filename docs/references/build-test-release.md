# Build, test, and release reference

Load this reference when building packages/plugins/WASM, running tests, or preparing an npm / GitHub release.

## Prerequisites

- **Node.js 22.18+** (workspace uses native TypeScript stripping for tests/scripts and Node's built-in `node:test`).
- **Rust toolchain** (only when editing `crates/`): `cargo`, `wasm32-unknown-unknown` target, `wasm-bindgen`, `wasm-opt`.
- **Chrome / Chromium** (for browser checks in `npm run e2e` and Motion `stills`).

## Build pipeline

```bash
npm ci                         # Install workspace dependencies
npm run build                  # Full build: cli, support, editors, types, shell, frame, dsh
node scripts/build-plugins.mjs # Build unified skill + dist/plugins/<name>/ + marketplace manifests
```

### Partial builds

- `node scripts/build.mjs --only <part>` where `<part>` is one of:
  - `cli` — bundles `dist/server/cli.mjs` (type server + standalone CLI)
  - `support` — bundles `dist/server/support.js` (`.dc.html` runtime)
  - `editors` — runs Vite builds for all 8 editors in `packages/*-editor` (each in its own process)
  - `types` — copies `dist/server/` into every `artifact-types/<type>/scripts/`
  - `shell` — builds `dist/daemon/shell/` and `dist/daemon/home/`
  - `frame` — builds `dist/daemon/frame-host/`
  - `dsh` — builds `plugins/dsh/` (`lib/`, the vendored daemon in `vendor/`, and the launcher `scripts/open-artifact.mjs` that makes the folder a runtime folder); `lib/client.js` bundles the library page from `packages/library-page`, with React left to DSH's loader
  - `sea` — the single executable `dist/sea/open-artifact-<platform>-<arch>` for this platform (`scripts/build-sea.mjs`; `--node <file>` or `OPEN_ARTIFACT_SEA_NODE` picks the Node to embed, an official build of Node 25.5+). Never part of the full build; needs `npm run build` and `node scripts/build-skill.mjs` first.
- `node scripts/build-plugins.mjs --only <app>` — builds one plugin (`claude-code`, `codex`, `cursor`, `copilot`, `antigravity`, `zcode`, `chatgpt`). Pass `--no-skill` to reuse an already-built skill.
- `node scripts/build-wasm.mjs` — compiles Rust crates under `crates/` and updates committed output under `packages/wasm-*/generated/`.

## Testing & verification

```bash
npm run typecheck                     # tsc -p tsconfig.json
npm test                              # node --test across packages/*, plugins/dsh, plugins/pi, plugins/zcode, examples/host-plugins, examples/harness-node, examples/harness-stdio, scripts
npm run check                         # typecheck + unit tests
npm run e2e                           # Full E2E suite (requires npm run build first)
npm run e2e -- --only slides,docs     # Run selected E2E suites
npm run e2e -- --no-browser           # Skip Chrome DevTools checks (E2E_BROWSER=0)
npm run e2e -- --keep                 # Keep temp artifact directories and print their paths
npm run e2e -- --only harness-compat  # Agent-app hosts built from examples/harness-node against a real daemon
npm run e2e -- --only type-packages   # Two daemons in two temporary homes: pack on one, install and open on the other, import back
npm run test:sea                      # Build and run the single executable with no node on PATH (not in npm test or e2e)
```

`examples/harness-node` and `examples/harness-stdio` (Python; skipped without `python3`) run against a real daemon in a
temporary home as part of `npm test`. `open-artifact doctor --harness <name> --session <id> --json` is the conformance
run an agent app can put in its own CI (`docs/integrating/testing.md`).

E2E tests copy built `artifact-types/` folders into isolated temporary directories outside the repo and drive them with Node's WebSocket client over Chrome DevTools Protocol (see `e2e/README.md`).

### Desktop app

`apps/desktop/` has its own `package.json` and lock file (Electron, esbuild, React and React DOM pinned); it is not a
workspace and not part of `npm test` or `npm run check`. `build.ts` bundles the main process (`src/` → `out/main.mjs`,
`out/preload.cjs`) and the window's page (`renderer/` → `out/renderer/app.js`, with the library page's `PAGE_CSS` as
`page.css`, `app.css` and `index.html`); React comes from `apps/desktop/node_modules`, one copy.

```bash
npm run build && node scripts/build-skill.mjs   # at the root: the runtime the app carries
cd apps/desktop
npm run setup                                   # npm install + install-electron (Electron 45 fetches its binary here)
npm run build                                   # scripts/build-runtime.ts → resources/runtime, then build.ts → out/ (main + renderer)
npm run typecheck                               # strict TypeScript: app, renderer, build scripts and all tests
npm test                                        # build, then test/*.test.ts one file at a time
npm run package                                 # build, then scripts/package.ts → dist/Open Artifact-darwin-arm64/Open Artifact.app
npm run package:release                         # Developer ID + notarization → dist/release/ ZIP, DMG, checksums, report
npm run test:release                            # release validation tests; no Apple credentials needed
npm run test:packaged                           # test/packaged/: the packaged app's checks (package first)
```

`scripts/build-runtime.ts` copies `skills/open-artifact` (`scripts/`, `vendor/`, `reference/`, `SKILL.md`) into
`resources/runtime` with a `package.json` naming the CLI version, and refuses a skill that is not built or whose version
differs from `packages/daemon`. The tests run with no `node` on PATH, a throwaway `HOME`/`OPEN_ARTIFACT_HOME`, a free
port other than 4800, the window hidden (`--test-mode`), and drive the app over its DevTools port; each stops the
daemons it started by their `daemon.json` pid (see `apps/desktop/README.md`). The runtime is copied, not linked: after
a change to the daemon or the Shell, run the root build and `node scripts/build-skill.mjs` again before
`npm run build` in `apps/desktop`, or the tests run the old daemon. A test that leaves a tab with unsaved work quits
with `app.quit({ force: true })` (the app would otherwise ask).

`npm run package` makes a folder-form macOS arm64 `.app` in `apps/desktop/dist/` (ignored by git) with
`@electron/packager`: the build's `out/` in `app.asar` (with `ElectronAsarIntegrity`), the runtime in
`Contents/Resources/runtime`, the type icons of installed artifact apps in `Contents/Resources/app-icons/`, a
placeholder icon, stable bundle id (`dev.openartifact.desktop`), Electron's fuses as they
are (`RunAsNode` on), signed ad hoc on this computer. `package:release` instead signs nested code with Developer ID,
hardened runtime and timestamps, notarizes/staples the app before archiving, verifies the extracted ZIP, and separately
signs/notarizes/staples the DMG; both pass Gatekeeper. Release packaging also writes the static Squirrel feed
`desktop-updates-darwin-arm64.json` from the final ZIP (GitHub URL, version, size, SHA-256). Only release packages set
`desktopUpdates: true`; the signed macOS app checks GitHub desktop releases and uses Electron's native updater.
Development, local ad hoc and test builds never check or install. Packaged, the app
with no arguments uses the person's own home and port, so `test/packaged/` only starts it with `--home`, a port other
than 4800, `--test-mode` and a throwaway `HOME`, and checks first that it then uses those folders only. A package
declares no URL scheme; `OA_DESKTOP_URL_SCHEME=1 npm run package` adds `open-artifact://` to its `Info.plist`
(`scripts/info-plist.ts`; checked by the unit tests, never built by them), and nothing registers it.
`test/packaged/installed-apps.test.ts`, `installed-apps-names.test.ts`, `installed-apps-manage.test.ts` and
`installed-apps-daemon.test.ts` install artifacts as apps from that package into the throwaway `HOME`'s
`Applications/` and start them only by their executable, with `--test-mode` and a port other than 4800
(`launchArtifactApp`). Test mode never opens a package and never uses the Trash (an uninstalled test package, checked
to be the record's, is removed). macOS keeps each started app's preferences in the account's own
`~/Library/Preferences` whatever `HOME` or `CFFIXED_USER_HOME` say (`cfprefsd` writes them), so the tests run
`defaults delete <bundle id>` for the exact ids they started (an uninstall does too), which clears the keys; an empty
`<bundle id>.plist` is still left there for each generated app a run started. An uninstall in test mode removes a
preferences file only inside the test's own `HOME` (the manage test plants one there and starts its desktop app with
`CFFIXED_USER_HOME` set to that `HOME`); a file in the account's own folder is left and logged. Run `npm run package` before `npm run test:packaged`, never at the same time.

Desktop owns its TypeScript 5.9 compiler and Electron, Node, React and Chrome DevTools Protocol types. Its strict
`tsconfig.json` covers `src/`, `renderer/`, `scripts/`, `test/` (including packaged tests) and `build.ts`; root
`npm run typecheck` does not include it. Run `npm run check` in `apps/desktop` for its typecheck and development
tests. Node 22.18+ runs the erasable TypeScript scripts/tests directly; esbuild emits Electron’s ESM main process,
CommonJS sandbox preloads and browser JavaScript into `out/`. See the bilingual
`apps/desktop/DEVELOPMENT.md` / `DEVELOPMENT.zh-CN.md` for the shared bridge and IPC contracts.

Desktop `package.json` and its lockfile now share the runtime version. The separate `desktop-v<version>` tag triggers
`.github/workflows/desktop-macos.yml` on native arm64 `macos-15`, with a `macos-release` Environment restricted to
`main` and desktop tags. Manual modes are `validate` (default, private-key signing probe and Apple access), `package`
(signed/notarized candidate only), and `publish` (existing tag required, checked against package/lock/runtime and
`origin/main`). Only the credential step receives Apple secrets; it uses an ephemeral keychain cleaned with `always()`.
The build runs desktop `check` and signed `test:packaged`; the publisher receives only the six public files
(ZIP, DMG, two checksums, release report, update feed), validates the feed against the signed ZIP,
verifies hashes before and after upload and anonymous public download, refuses changed existing assets, and leaves
GitHub Latest and npm releases alone. Retry only the failed publisher to reuse its original candidate. Details and
secret names: `apps/desktop/RELEASING.md` / `RELEASING.zh-CN.md`.

`test/app-update.test.ts` covers release filtering/pagination, metadata validation, automatic-check timing and
preferences, opt-in downloads, retry, install confirmation and disabled builds without networking or installing.
`test/app-update-download.test.ts` checks real byte counting, SHA-256/size rejection, cancellation/partial-file cleanup
and the private native handoff server's routes and shutdown. The sidebar shows an Update button beside Settings only
when an update exists; its window displays transferred/total bytes and supports cancel during remote transfer.
`test/release.test.ts` rejects an update feed that differs from the signed candidate. `test/settings-dialog.test.ts`
checks the separate desktop-update controls, saved preferences and test-mode refusal through real Electron IPC.

## Releasing

`node scripts/build-npm.mjs` stages publishable packages into `dist/npm/`: the `@open-artifact/*` libraries, `@open-artifact/cli`, `dsh-open-artifact`, and `pi-open-artifact` (copied from `plugins/pi` as it is: Pi loads its TypeScript directly). `@open-artifact/library-page` is private and not staged: the DSH plugin bundles it into its `lib/client.js` and Open Artifact Desktop into its window page; publish it when a host outside this repository needs it.
`@open-artifact/cli` is the skill folder: its `files` are `scripts/`, `vendor/`, `reference/` (the skill's guides, such as `new-type.md`) and `SKILL.md`.
The libraries are compiled with `tsc` (`rewriteRelativeImportExtensions`, which fixes `./x.ts` imports in the emitted JavaScript only); the script then rewrites relative `.ts`/`.tsx`/`.mts`/`.cts` specifiers in every staged `.d.ts` (compiled or authored) to `.js`/`.js`/`.mjs`/`.cjs` (`scripts/declaration-specifiers.mjs`, tested by `scripts/declaration-specifiers.test.mjs`) and fails the build if one is left.

1. **Bump versions in lockstep**: every `@open-artifact/*` package, `plugins/dsh`, `plugins/pi`, every plugin manifest, and marketplace manifests share one version.
2. **Gather commits**: run `node scripts/changelog.mjs` (lists commits since last `v*` tag; pass `<from> <to>` for a custom range).
3. **Update `CHANGELOG.md`**: add `## [x.y.z] - YYYY-MM-DD` at the top with a one-line summary and user-facing `### Added`, `### Changed`, `### Fixed` (and `### Removed` when applicable) sections. Merge related commits; omit release bookkeeping and purely internal refactors. Add the compare link at the bottom:
   `[x.y.z]: https://github.com/JimLiu/open-artifact/compare/v<prev>...vx.y.z`
   From 0.14.0, when a file in `INTEGRATOR_PATHS` (`scripts/changelog.mjs`: `packages/protocol/src/{harness,wake,shell}.ts`, `packages/harness-kit/src/`, `packages/daemon/harnesses/`, `packages/daemon/src/stdio-bridge.ts`) changed since the previous tag, the entry also needs `### Integrators` saying what changed for apps built on the Harness API or the kit (or that nothing they use did).
4. **Verify changelog**: `node scripts/changelog.mjs --check x.y.z` (it fails a release that needs `### Integrators` and lacks it, naming the files; in a shallow clone it skips that rule with a warning). The Publish to npm workflow checks out with `fetch-depth: 0`, so there the rule is always checked.
5. **Commit, tag, and push**: tag `vx.y.z` and push the tag. `.github/workflows/publish-npm.yml` validates the changelog entry, publishes new versions to npm via trusted publishing, attaches `open-artifact-plugins.zip` to the GitHub Release, and uses the changelog entry as release notes.

Local/first-time npm helpers:
- `node scripts/publish-npm.mjs --dry-run` — preview local npm publishing.
- `node scripts/publish-npm.mjs --claim` — claim a brand-new npm package and register the GitHub Actions workflow as its trusted publisher.

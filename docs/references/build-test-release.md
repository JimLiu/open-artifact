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
  - `dsh` — builds `plugins/dsh/` (`lib/` and vendored daemon in `vendor/`)
- `node scripts/build-plugins.mjs --only <app>` — builds one plugin (`claude-code`, `codex`, `cursor`, `copilot`, `antigravity`, `zcode`, `chatgpt`). Pass `--no-skill` to reuse an already-built skill.
- `node scripts/build-wasm.mjs` — compiles Rust crates under `crates/` and updates committed output under `packages/wasm-*/generated/`.

## Testing & verification

```bash
npm run typecheck                     # tsc -p tsconfig.json
npm test                              # node --test across packages/*, plugins/dsh, examples/host-plugins
npm run check                         # typecheck + unit tests
npm run e2e                           # Full E2E suite (requires npm run build first)
npm run e2e -- --only slides,docs     # Run selected E2E suites
npm run e2e -- --no-browser           # Skip Chrome DevTools checks (E2E_BROWSER=0)
npm run e2e -- --keep                 # Keep temp artifact directories and print their paths
```

E2E tests copy built `artifact-types/` folders into isolated temporary directories outside the repo and drive them with Node's WebSocket client over Chrome DevTools Protocol (see `e2e/README.md`).

## Releasing

`node scripts/build-npm.mjs` stages publishable packages into `dist/npm/`: the `@open-artifact/*` libraries, `@open-artifact/cli`, and `dsh-open-artifact`.

1. **Bump versions in lockstep**: every `@open-artifact/*` package, `plugins/dsh`, every plugin manifest, and marketplace manifests share one version.
2. **Gather commits**: run `node scripts/changelog.mjs` (lists commits since last `v*` tag; pass `<from> <to>` for a custom range).
3. **Update `CHANGELOG.md`**: add `## [x.y.z] - YYYY-MM-DD` at the top with a one-line summary and user-facing `### Added`, `### Changed`, `### Fixed` (and `### Removed` when applicable) sections. Merge related commits; omit release bookkeeping and purely internal refactors. Add the compare link at the bottom:
   `[x.y.z]: https://github.com/JimLiu/open-artifact/compare/v<prev>...vx.y.z`
4. **Verify changelog**: `node scripts/changelog.mjs --check x.y.z`.
5. **Commit, tag, and push**: tag `vx.y.z` and push the tag. `.github/workflows/publish-npm.yml` validates the changelog entry, publishes new versions to npm via trusted publishing, attaches `open-artifact-plugins.zip` to the GitHub Release, and uses the changelog entry as release notes.

Local/first-time npm helpers:
- `node scripts/publish-npm.mjs --dry-run` — preview local npm publishing.
- `node scripts/publish-npm.mjs --claim` — claim a brand-new npm package and register the GitHub Actions workflow as its trusted publisher.

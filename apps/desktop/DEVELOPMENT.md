# Desktop TypeScript development

The desktop app owns its dependencies and lock file. It is outside the root npm workspace, so root typechecking
and unit tests do not check it. Node.js 22.18+ is required.

From the repository root, build the runtime before setting up the desktop app:

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

`tsconfig.json` inherits strict workspace settings and enables `erasableSyntaxOnly`. Node runs `.ts` scripts and tests
directly. Source imports use `.ts` / `.tsx`. Esbuild emits the main entry as `out/main.mjs`, sandbox preloads as
`out/*.cjs`, and renderer scripts as browser `.js`; Electron loads only those generated files. `out/`, `resources/`
and `dist/` are generated and excluded from typechecking.

`src/contracts.ts` is the shared contract for `window.desktop`, `window.artifactApp`, `window.notice` and request/response
IPC channels. `src/ipc.ts` checks main-process handler signatures and verifies the sender; `src/ipc-client.ts` confines
Electron's untyped request transport to one adapter. Pages declare their globals in `renderer/globals.d.ts`.
`src/installed-app-types.ts` models the install journal, native operations and discriminated installation states.
Test CDP commands and events use `devtools-protocol`'s protocol map.

Add concrete fields and state variants to these contracts when extending the app. Preserve runtime checks for
IPC arguments and data read from disk or subprocesses; `unknown` belongs at those input boundaries and in generic
helpers. Do not replace application models with `any`, catch-all dynamic aliases or TypeScript suppression comments.

# Playground engines

The docs and sheets demos run the real server-side engines in the page: the Docs host and the Sheets store from
`packages/type-server`, bundled for the browser by `build.mjs` (esbuild from the repo's root `node_modules`) into
`../src/engines/bundles/docHost.js` and `sheetHost.js`. Vite then makes each a lazy chunk loaded only by its own demo
(`../src/engines/load.ts`). Nothing under `packages/` is changed to make this work. This file keeps the recipe from the
original feasibility spike.

```bash
node website/playground/engines/build.mjs [--minify]   # also run by npm run build / npm run dev
```

## Node built-ins

Every Node built-in the engines import is aliased to a browser module. Any other `node:` import fails the build and
names the file that imports it, so a new dependency can't break the page without notice.

| Built-in | Stand-in |
| --- | --- |
| `fs`, `fs/promises` | The Cloudflare host's replacement file system (`packages/host-cloudflare/src/fs`). Unmounted paths are plain memory. |
| `path`, `path/posix` | `shims/path.js`: path-browserify, with `win32` set to POSIX too (docs code calls `path.win32.join` on load). |
| `buffer`, `events` | The `buffer` and `events` npm packages. |
| `crypto` | `shims/crypto.js`: synchronous SHA-1/256/512 from `@noble/hashes`, plus `getRandomValues` for bytes and UUIDs. |
| `zlib` | `shims/zlib.js`, using `fflate`. |
| `util`, `url`, `os`, `stream`, `stream/promises` | Small shims in `shims/`. |
| `child_process`, `net`, `http`, `https`, `dns`, `worker_threads`, `readline`, `module` | `shims/unavailable.js`: importing works, and any call throws `ENOSYS`. Only Node-only extras reach these, and those are off as in hosted mode. |

`shims/globals.js` is injected into every module. It provides `Buffer`, a `process` stand-in, and timers whose handles
have `unref()` and `ref()`. The build also defines `import.meta.url` as `file:///bundle/<name>`, `global` as
`globalThis`, and `process.env.NODE_ENV`.

## WebAssembly (Sheets)

`@open-artifact/wasm-sheets/node` is aliased to `shims/wasm-sheets.ts`. A browser main thread refuses to compile a
module this large synchronously, so `prepareSheetsEngine()` compiles and instantiates it asynchronously, and the sheet
capability waits for it before it makes the store. The bundle includes no `.wasm` file. The demo passes in the sheets
editor's own hashed copy (`editors/sheets/assets/open_artifact_sheets_bg-*.wasm`, which `vite.config.ts` names at build
time as `__SHEETS_WASM__`), so the page and the editor's worker share one download. Serve it as `application/wasm` so
it compiles while it streams.

## The archive.ts stub

`type-server/src/archive.ts` loads `./server.ts` lazily, only for `detectType` when an archive is imported. Following
that import would pull the whole HTTP server into the bundle, so `build.mjs` resolves `./server.ts` from `archive.ts`
to a stub whose `detectType` throws "not available in the browser playground".

## Memory

Every bundle has its own copy of the in-memory file system. Artifacts live under `/artifacts/<name>-<n>` (see
`src/memfs.ts`), and exports use `/tmp`. Scratch memory is capped at 64 MB (`DEFAULT_SCRATCH_BYTES` in
`packages/host-cloudflare/src/fs/mounts.ts`; `setScratchLimit` changes it). That is far more than a demo needs, but
large uploads or exports in a demo would hit the cap.

## Types

The bundles' types are written by hand beside them (`../src/engines/bundles/docHost.d.ts`, `sheetHost.d.ts`) and are
tracked in the repo. Keep them in step with `src/doc-host.ts` and `src/sheet-host.ts`. `npm run typecheck` checks
`src/` and `shims/wasm-sheets.ts` against the repo's TypeScript settings.

## Off the main thread

The spike also ran both bundles unchanged in a module Worker. The playground runs them on the main thread, but moving
them into a worker needs no change to the bundles.

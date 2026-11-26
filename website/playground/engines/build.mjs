// Bundles the real Docs host and Sheets store for the playground's docs and sheets demos (the recipe: README.md here):
//
//   src/engines/bundles/docHost.js     createDocCapability(seed, options) → { capability, files(), host, root }
//   src/engines/bundles/sheetHost.js   createSheetCapability(seed, wasmUrl, options) → { capability, files(), agentRead(), exportFile(), store, root }
//
// Vite then bundles each into a chunk of its own, loaded by a dynamic import on its demo only (src/engines/load.ts),
// and minifies it. The Sheets engine's WebAssembly is not copied here: the demo hands the store the sheets editor's
// own hashed copy (editors/sheets/assets/open_artifact_sheets_bg-*.wasm), so the page and the editor's worker share
// one download. Nothing under packages/ is changed: every Node built-in is aliased to a browser module (shims/, the
// Cloudflare host's replacement fs, the `buffer`/`events`/`path-browserify` packages), and any other `node:` import
// fails the build.
//
//   node website/playground/engines/build.mjs [--minify]
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const playground = join(here, '..');
const repo = join(playground, '../..');
// The repository's esbuild (root node_modules), so the playground installs no bundler of its own.
const esbuild = createRequire(join(repo, 'package.json'))('esbuild');
const minify = process.argv.includes('--minify');
const dist = join(playground, 'src', 'engines', 'bundles');
const shims = join(here, 'shims');
const local = createRequire(join(playground, 'package.json'));
const fsDir = join(repo, 'packages/host-cloudflare/src/fs');

const unavailable = join(shims, 'unavailable.js');
/** Node built-in (without `node:`) → the file that stands in for it. */
const builtins = {
  fs: join(fsDir, 'index.ts'),
  'fs/promises': join(fsDir, 'promises.ts'),
  path: join(shims, 'path.js'),
  'path/posix': join(shims, 'path.js'),
  buffer: local.resolve('buffer/'),
  events: local.resolve('events/'),
  crypto: join(shims, 'crypto.js'),
  zlib: join(shims, 'zlib.js'),
  util: join(shims, 'util.js'),
  url: join(shims, 'url.js'),
  os: join(shims, 'os.js'),
  stream: join(shims, 'stream.js'),
  'stream/promises': join(shims, 'stream.js'),
  child_process: unavailable,
  net: unavailable,
  http: unavailable,
  https: unavailable,
  dns: unavailable,
  'dns/promises': unavailable,
  worker_threads: unavailable,
  readline: unavailable,
  module: unavailable,
};
const BUILTIN = new RegExp(`^(node:)?(${Object.keys(builtins).map((k) => k.replace('/', '\\/')).join('|')})$`);

const browserPlugin = {
  name: 'open-artifact-browser',
  setup(build) {
    build.onResolve({ filter: BUILTIN }, (args) => ({ path: builtins[args.path.replace(/^node:/, '')] }));
    // Any other `node:` module would be a new landmine: fail the build, naming who imports it.
    build.onResolve({ filter: /^node:/ }, (args) => ({ errors: [{ text: `${args.path} (imported by ${relative(repo, args.importer)}) has no browser stand-in in build.mjs` }] }));
    build.onResolve({ filter: /^@open-artifact\/wasm-sheets\/node$/ }, () => ({ path: join(shims, 'wasm-sheets.ts') }));
    // archive.ts loads server.ts lazily for `detectType` (archive import only): it would pull in the whole HTTP server.
    build.onResolve({ filter: /^\.\/server\.ts$/ }, (args) =>
      args.importer.endsWith(join('type-server', 'src', 'archive.ts')) ? { path: 'server-stub', namespace: 'stub' } : null,
    );
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `export const detectType = () => { throw new Error('Importing an artifact archive is not available in the browser playground.'); };`,
      loader: 'js',
    }));
  },
};

mkdirSync(dist, { recursive: true });
for (const name of ['docHost.js', 'sheetHost.js', 'docHost.js.meta.json', 'sheetHost.js.meta.json']) rmSync(join(dist, name), { force: true });

async function bundle(entry, outName) {
  const result = await esbuild.build({
    entryPoints: [join(here, 'src', entry)],
    outfile: join(dist, outName),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify,
    sourcemap: false,
    metafile: true,
    logLevel: 'warning',
    // The type server's sources resolve their `@open-artifact/*` imports through the root node_modules workspaces.
    nodePaths: [join(repo, 'node_modules')],
    inject: [join(shims, 'globals.js')],
    define: {
      // Several modules make file URLs from it when they load; a browser bundle's own URL is no file.
      'import.meta.url': JSON.stringify(`file:///bundle/${outName}`),
      'process.env.NODE_ENV': '"production"',
      global: 'globalThis',
    },
    plugins: [browserPlugin],
  });
  writeFileSync(join(dist, `${outName}.meta.json`), JSON.stringify(result.metafile));
  const inputs = Object.keys(result.metafile.inputs).length;
  console.log(`engines: ${relative(repo, join(dist, outName))} ${(statSync(join(dist, outName)).size / 1024).toFixed(0)} KiB from ${inputs} files${minify ? ' (minified)' : ''}`);
}

await bundle('doc-host.ts', 'docHost.js');
await bundle('sheet-host.ts', 'sheetHost.js');
// Their types are declared beside them by hand (docHost.d.ts, sheetHost.d.ts, kept in the repository).

/**
 * The playground: a static site. `index.html` lists the demos; `<demo>/` (and `demo.html?type=<demo>`) is the Shell over
 * an in-memory artifact (see pages.ts). `PLAYGROUND_BASE` sets the base it is served from, such as `/playground/` (the
 * default, `./`, works from any path). The prebuilt editors (`dist/server/editors/<type>/`, from `npm run build` at the repo root) are served at
 * `editors/<type>/` in dev and preview, and copied there by `vite build`: only the types a demo uses.
 */

import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { demoPageHtml, landingHtml, writeDemoPages } from './pages.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const EDITORS = path.join(REPO, 'dist', 'server', 'editors');
/** The artboard runtime the design editor's frames load (`<editor>/support.js`, as the type server serves it). */
const SUPPORT = path.join(REPO, 'dist', 'server', 'support.js');
/** The types whose pages load `support.js` beside their editor. */
const SUPPORT_TYPES = new Set(['design', 'design-system']);
/**
 * A page artifact has no editor: frame-host's inner shell frames the artifact's own index.html, with its comment views
 * and the page runtime (`dist/daemon/frame-host/client/`). Served at `frame-host/` for the page demo.
 */
const FRAME_CLIENT = path.join(REPO, 'dist', 'daemon', 'frame-host', 'client');
const FRAME_ROUTE = '/frame-host/';
const FRAME_FILES = new Set(['shell.js', 'shell.css', 'comments.js', 'comments.css', 'runtime.js', 'imports.js']);
const ROUTE = '/editors/';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

/** The editor types the demos use (`demos/*.demo.json`). */
function demoTypes(): string[] {
  const dir = path.join(HERE, 'demos');
  const types = fs.readdirSync(dir).filter((f) => f.endsWith('.demo.json')).map((f) => (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { type: string }).type);
  return [...new Set(types)].sort();
}

function editorFolder(type: string): string {
  const folder = path.join(EDITORS, type);
  if (!fs.existsSync(path.join(folder, 'index.html'))) throw new Error(`No built ${type} editor at ${folder}: run npm run build at the repo root.`);
  return folder;
}

/**
 * The sheets editor's own hashed copy of the Sheets engine (`editors/sheets/assets/open_artifact_sheets_bg-*.wasm`):
 * the sheets demo's store compiles that same file (src/engines/load.ts), so the page and the editor's worker share one
 * download. A static host should serve it as `application/wasm` (streaming compile) and may cache it for good: its
 * name changes with its content.
 */
function sheetsWasm(): string {
  if (!demoTypes().includes('sheets')) return '';
  const assets = path.join(editorFolder('sheets'), 'assets');
  const name = fs.readdirSync(assets).find((f) => /^open_artifact_sheets_bg-.*\.wasm$/.test(f));
  if (!name) throw new Error(`No Sheets engine in ${assets}: run npm run build at the repo root.`);
  return `editors/sheets/assets/${name}`;
}

function frameClient(): string {
  if (!fs.existsSync(path.join(FRAME_CLIENT, 'shell.js'))) throw new Error(`No built frame-host client at ${FRAME_CLIENT}: run npm run build at the repo root.`);
  return FRAME_CLIENT;
}

/**
 * Serves `editors/<type>/…` from the built editors and `frame-host/…` from the frame-host client (dev and preview);
 * copies them into the build.
 */
function editors(): Plugin {
  const all = demoTypes();
  const page = all.includes('page');
  const types = all.filter((type) => type !== 'page');
  const send = (res: Parameters<Connect.NextHandleFunction>[1], file: string): void => {
    res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  };
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://playground');
    const frameAt = url.pathname.indexOf(FRAME_ROUTE);
    if (page && frameAt >= 0) {
      const name = url.pathname.slice(frameAt + FRAME_ROUTE.length);
      if (!FRAME_FILES.has(name)) return next();
      return send(res, path.join(frameClient(), name));
    }
    const at = url.pathname.indexOf(ROUTE);
    if (at < 0) return next();
    const rest = decodeURIComponent(url.pathname.slice(at + ROUTE.length));
    const [type, ...parts] = rest.split('/');
    if (!type || !types.includes(type)) return next();
    const root = editorFolder(type);
    const rel = parts.join('/') || 'index.html';
    if (rel === 'support.js' && SUPPORT_TYPES.has(type)) return send(res, SUPPORT);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
    send(res, file);
  };
  return {
    name: 'playground-editors',
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    writeBundle(options) {
      const out = options.dir ?? path.join(HERE, 'dist');
      for (const type of types) {
        fs.cpSync(editorFolder(type), path.join(out, 'editors', type), { recursive: true });
        if (SUPPORT_TYPES.has(type)) fs.copyFileSync(SUPPORT, path.join(out, 'editors', type, 'support.js'));
      }
      if (page) {
        fs.mkdirSync(path.join(out, 'frame-host'), { recursive: true });
        for (const name of FRAME_FILES) fs.copyFileSync(path.join(frameClient(), name), path.join(out, 'frame-host', name));
      }
    },
  };
}

/** The landing page's cards, and a real page per demo at `<demo>/` (built, and answered by the dev server). */
function pages(): Plugin {
  const types = demoTypes();
  let base = './';
  return {
    name: 'playground-pages',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: { order: 'pre', handler: (html) => landingHtml(html, types) },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://playground');
        const at = url.pathname.startsWith(server.config.base) ? url.pathname.slice(server.config.base.length) : '';
        const type = /^([\w-]+)\/(?:index\.html)?$/.exec(at)?.[1];
        if (!type || !types.includes(type)) return next();
        // Relative URLs one folder up, as in a relative build: the dev server serves the sources from the root.
        const html = demoPageHtml(fs.readFileSync(path.join(HERE, 'demo.html'), 'utf8'), type, './');
        server
          .transformIndexHtml(url.pathname, html)
          .then((out) => {
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(out);
          })
          .catch(next);
      });
    },
    writeBundle(options) {
      writeDemoPages(options.dir ?? path.join(HERE, 'dist'), types, base);
    },
  };
}

export default defineConfig({
  root: HERE,
  // Relative by default: the built site works from any path of a static host. The website's build sets an absolute one.
  base: process.env.PLAYGROUND_BASE || './',
  plugins: [tailwindcss(), editors(), pages()],
  define: { __SHEETS_WASM__: JSON.stringify(sheetsWasm()) },
  server: { host: '127.0.0.1', port: 5190, strictPort: true, fs: { allow: [REPO] } },
  preview: { host: '127.0.0.1', port: 5191, strictPort: true },
  build: {
    outDir: path.join(HERE, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { index: path.join(HERE, 'index.html'), demo: path.join(HERE, 'demo.html'), page: path.join(HERE, 'page-shell.html') },
      onwarn(warning, warn) {
        // Base UI marks its modules "use client"; meaningless in a client bundle.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
});

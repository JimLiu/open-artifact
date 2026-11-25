// Bundles the app's main process into out/main.mjs (the workspace packages it uses, @open-artifact/harness-kit,
// @open-artifact/protocol and @open-artifact/library-page/library, are compiled in from their TypeScript sources;
// `electron` is left to Electron), copies the window's preload beside it, builds the window's page into out/renderer/
// (a React app: renderer/src/main.jsx → app.js, the home page's CSS → page.css, the window's own → app.css, and
// index.html), and bundles the probe the no-Node test runs (out/test/chain-probe.mjs).
//
// The page's React is this app's own (node_modules/react, the version the workspace uses): every import of react and
// react-dom, the shared page package's and zustand's too, is pointed at it, so the page has exactly one React.
// The page's CSS is a file (its Content-Security-Policy allows no inline style), written from the package's PAGE_CSS
// and UPDATE_CSS (the runtime's update panel at the top of the library).
//
//   node build.mjs        (from apps/desktop; `npm run build` also builds the runtime it carries)
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const here = import.meta.dirname;
const out = join(here, 'out');
mkdirSync(join(out, 'test'), { recursive: true });
rmSync(join(out, 'renderer'), { recursive: true, force: true });
mkdirSync(join(out, 'renderer'), { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  // Electron 45 runs Node 24; the kit asks for Node 22.18 or later.
  target: 'node22',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
  banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
};

buildSync({ ...common, entryPoints: [join(here, 'src', 'main.mjs')], outfile: join(out, 'main.mjs'), external: ['electron'] });
copyFileSync(join(here, 'src', 'preload.cjs'), join(out, 'preload.cjs'));
copyFileSync(join(here, 'src', 'notice-preload.cjs'), join(out, 'notice-preload.cjs'));

// ---- the window's page ----
const own = (name) => join(here, 'node_modules', name);
buildSync({
  entryPoints: [join(here, 'renderer', 'src', 'main.jsx')],
  outfile: join(out, 'renderer', 'app.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome140',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  alias: { react: own('react'), 'react-dom': own('react-dom'), scheduler: own('scheduler') },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
});
const { PAGE_CSS, UPDATE_CSS } = await import(pathToFileURL(join(here, '..', '..', 'packages', 'library-page', 'src', 'styles.ts')).href);
writeFileSync(join(out, 'renderer', 'page.css'), `/* @open-artifact/library-page PAGE_CSS and UPDATE_CSS, written by build.mjs */\n${PAGE_CSS.trim()}\n${UPDATE_CSS.trim()}\n`);
copyFileSync(join(here, 'renderer', 'src', 'app.css'), join(out, 'renderer', 'app.css'));
copyFileSync(join(here, 'renderer', 'index.html'), join(out, 'renderer', 'index.html'));
// The "saved" notice's page (a view of its own over the artifact's): plain files, no React.
cpSync(join(here, 'renderer', 'notice'), join(out, 'renderer', 'notice'), { recursive: true });
buildSync({ ...common, entryPoints: [join(here, 'test', 'probe', 'chain-probe.mjs')], outfile: join(out, 'test', 'chain-probe.mjs') });
console.log(`built ${out}`);

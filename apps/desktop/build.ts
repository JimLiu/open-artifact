// Bundles the app's main process (src/start.ts) into out/main.mjs (the workspace packages it uses, @open-artifact/harness-kit,
// @open-artifact/protocol and @open-artifact/library-page/library, are compiled in from their TypeScript sources;
// `electron` is left to Electron), bundles the sandbox preloads beside it, builds the window's page into out/renderer/
// (a React app: renderer/src/main.tsx → app.js, the home page's CSS → page.css, the window's own → app.css, the
// Tailwind utilities of the UI kit's components it uses → ui.css, and index.html), and bundles the probe the no-Node
// test runs (out/test/chain-probe.mjs). It also writes the app's icon as out/icon.png, which a development run puts
// in the Dock.
//
// The page's React is this app's own (node_modules/react, the version the workspace uses): every import of react and
// react-dom, the shared page package's and zustand's too, is pointed at it, so the page has exactly one React.
// The page's CSS is a file (its Content-Security-Policy allows no inline style), written from the package's PAGE_CSS
// and UPDATE_CSS (the runtime's update panel at the top of the library).
//
//   node build.ts        (from apps/desktop; `npm run build` also builds the runtime it carries)
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { buildSync, type BuildOptions } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_CSS, UPDATE_CSS } from '../../packages/library-page/src/styles.ts';
import { drawIcon } from './scripts/placeholder-icon.ts';

const here = import.meta.dirname;
const out = join(here, 'out');
mkdirSync(join(out, 'test'), { recursive: true });
rmSync(join(out, 'renderer'), { recursive: true, force: true });
mkdirSync(join(out, 'renderer'), { recursive: true });

const common: BuildOptions = {
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

// The app's icon as a PNG, for the Dock of a development run (a packaged app carries the .icns).
writeFileSync(join(out, 'icon.png'), drawIcon(512));

// The entry is start.ts: the desktop app (main.ts), or an artifact installed as an app (artifact-app.ts).
buildSync({ ...common, entryPoints: [join(here, 'src', 'start.ts')], outfile: join(out, 'main.mjs'), external: ['electron'] });
for (const name of ['preload', 'artifact-preload', 'notice-preload']) {
  buildSync({
    entryPoints: [join(here, 'src', `${name}.ts`)],
    outfile: join(out, `${name}.cjs`),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  });
}

// ---- the window's page ----
const own = (name: string) => join(here, 'node_modules', name);
buildSync({
  entryPoints: [join(here, 'renderer', 'src', 'main.tsx')],
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
writeFileSync(
  join(out, 'renderer', 'page.css'),
  `/* @open-artifact/library-page PAGE_CSS and UPDATE_CSS, written by build.ts */\n${PAGE_CSS.trim()}\n${UPDATE_CSS.trim()}\n`,
);
copyFileSync(join(here, 'renderer', 'src', 'app.css'), join(out, 'renderer', 'app.css'));
// The UI kit's components the page uses (the tab bar's row and its menus) are styled with Tailwind: their classes,
// and nothing else, are compiled from renderer/src/ui.css.
const kit = join(here, '..', '..', 'packages', 'ui', 'src');
const uiSource = join(here, 'renderer', 'src', 'ui.css');
const tailwind = await compile(readFileSync(uiSource, 'utf8'), { base: join(here, 'renderer', 'src'), onDependency() {} });
const candidates = new Scanner({ sources: [{ base: kit, pattern: '{tab-strip,menu}.tsx', negated: false }] }).scan();
writeFileSync(join(out, 'renderer', 'ui.css'), optimize(tailwind.build(candidates), { minify: true }).code);
copyFileSync(join(here, 'renderer', 'index.html'), join(out, 'renderer', 'index.html'));
// The "saved" notice's page (a view of its own over the artifact's): plain files, no React.
for (const [dir, entry] of [
  ['notice', 'notice'],
  ['artifact-app', 'status'],
]) {
  const dest = join(out, 'renderer', dir);
  cpSync(join(here, 'renderer', dir), dest, { recursive: true, filter: (path) => !path.endsWith('.ts') });
  buildSync({
    entryPoints: [join(here, 'renderer', dir, `${entry}.ts`)],
    outfile: join(dest, `${entry}.js`),
    bundle: true,
    platform: 'browser',
    target: 'chrome140',
  });
}
// The status page of an artifact installed as an app: plain files, no React.

buildSync({ ...common, entryPoints: [join(here, 'test', 'probe', 'chain-probe.ts')], outfile: join(out, 'test', 'chain-probe.mjs') });
console.log(`built ${out}`);

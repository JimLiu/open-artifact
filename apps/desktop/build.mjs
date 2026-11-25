// Bundles the app's main process into out/main.mjs (the workspace packages it uses, @open-artifact/harness-kit and
// @open-artifact/protocol, are compiled in from their TypeScript sources; `electron` is left to Electron), copies the
// window's preload beside it, and bundles the probe the no-Node test runs (out/test/chain-probe.mjs).
//
//   node build.mjs        (from apps/desktop; `npm run build` also builds the runtime it carries)
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const here = import.meta.dirname;
const out = join(here, 'out');
mkdirSync(join(out, 'test'), { recursive: true });

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
buildSync({ ...common, entryPoints: [join(here, 'test', 'probe', 'chain-probe.mjs')], outfile: join(out, 'test', 'chain-probe.mjs') });
console.log(`built ${out}`);

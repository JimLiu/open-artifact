#!/usr/bin/env node
// Builds the whole website into website/dist/: the static site (site/) at the root and the live demos (playground/)
// under playground/. Each half keeps its own build; this runs both with the same base and puts them together.
//
//   node website/build.mjs                       # site at /, playground at /playground/
//   SITE_BASE=/open-artifact/ SITE_URL=https://example.org node website/build.mjs
//   node website/build.mjs --skip-install        # never run npm ci in a half that has no node_modules
//
// Needs the repo's own build first (npm install && npm run build at the repo root): the playground copies the built
// editors from dist/server/editors/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, 'site');
const PLAYGROUND = path.join(HERE, 'playground');
const OUT = path.join(HERE, 'dist');
const skipInstall = process.argv.includes('--skip-install');

let base = process.env.SITE_BASE || '/';
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base += '/';

function run(cwd, args, env = {}) {
  console.log(`\n> (${path.relative(HERE, cwd)}) npm ${args.join(' ')}`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\nwebsite build failed in ${path.relative(HERE, cwd)} (npm ${args.join(' ')})`);
    process.exit(r.status ?? 1);
  }
}

function install(dir) {
  if (fs.existsSync(path.join(dir, 'node_modules'))) return;
  if (skipInstall) throw new Error(`${dir} has no node_modules: run npm ci there`);
  run(dir, ['ci']);
}

/** Total bytes and file count under a folder. */
function sizeOf(dir) {
  let bytes = 0;
  let files = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    bytes += fs.statSync(path.join(e.parentPath, e.name)).size;
    files += 1;
  }
  return { bytes, files };
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

if (!fs.existsSync(path.join(HERE, '..', 'dist', 'server', 'editors'))) {
  console.error('No built editors at dist/server/editors/: run npm install && npm run build at the repo root first.');
  process.exit(1);
}

install(PLAYGROUND);
install(SITE);
run(PLAYGROUND, ['run', 'build'], { PLAYGROUND_BASE: `${base}playground/` });
run(SITE, ['run', 'build'], { SITE_BASE: base });

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(SITE, 'dist'), OUT, { recursive: true });
if (fs.existsSync(path.join(OUT, 'playground'))) throw new Error('site/dist already has a playground/ folder');
fs.cpSync(path.join(PLAYGROUND, 'dist'), path.join(OUT, 'playground'), { recursive: true });

// Cache headers for hosts that read a _headers file (Cloudflare Pages, Netlify): content-hashed files (the site's and
// playground's assets, the editors' assets, the Sheets engine's .wasm among them) for good. Other hosts ignore it.
const at = (p) => `${base}${p}`;
fs.writeFileSync(
  path.join(OUT, '_headers'),
  [
    `${at('assets/*')}`,
    '  Cache-Control: public, max-age=31536000, immutable',
    `${at('playground/assets/*')}`,
    '  Cache-Control: public, max-age=31536000, immutable',
    `${at('playground/editors/*/assets/*')}`,
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'),
);

const all = sizeOf(OUT);
const play = sizeOf(path.join(OUT, 'playground'));
console.log(`\nwebsite/dist: ${all.files} files, ${mb(all.bytes)} (playground/: ${play.files} files, ${mb(play.bytes)}); base ${base}`);

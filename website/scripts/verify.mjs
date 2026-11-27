#!/usr/bin/env node
// Checks the built website (website/dist, from build.mjs) as a static host serves it: every internal link and anchor
// resolves, the home page's live stage frames the demos (verify-home.mjs), then the playground's own end-to-end checks
// (playground/scripts/verify.mjs) run against /playground/. The last two need Chrome (see e2e/lib/browser.mjs).
//
//   node website/scripts/verify.mjs            (SITE_BASE as for the build; ONLY=… passes through to the demos' checks)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLinks } from './check-links.mjs';
import { serve } from './serve.mjs';
import { verifyHome } from './verify-home.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
let base = process.env.SITE_BASE || '/';
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base += '/';

const links = checkLinks(DIST, base);
for (const b of links.broken.slice(0, 50)) console.log(`BROKEN ${b.from} -> ${b.link} (${b.why})`);
console.log(`links: ${links.pages} pages, ${links.checked} internal links checked, ${links.broken.length} broken`);

const server = await serve({ dir: DIST, port: 0, base });
const site = `http://127.0.0.1:${server.address().port}${base}`;
const home = await verifyHome(site);
const url = `${site}playground/`;
console.log(`\nplayground: ${url}`);
// Async, so this process's server keeps answering the browser while the checks run.
const status = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(HERE, '..', 'playground', 'scripts', 'verify.mjs'), url], { stdio: 'inherit' });
  child.on('exit', (code) => resolve(code ?? 1));
});
server.close();
process.exit(links.broken.length || home || status ? 1 : 0);

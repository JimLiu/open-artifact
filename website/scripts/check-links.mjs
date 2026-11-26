#!/usr/bin/env node
// Checks every internal link of the built website: each href/src in an HTML page must name a file in the build (a
// folder means its index.html), and each #fragment an id on the target page. External links are not fetched.
//
//   node website/scripts/check-links.mjs [dir, default website/dist]   (SITE_BASE=/sub/ when built under a base)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Broken links under `dir`, as `{from, link, why}`; plus how many links were checked. */
export function checkLinks(dir, base = '/') {
  const root = path.resolve(dir);
  const pages = fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.html')).map((f) => path.join(root, f));
  const ids = new Map();
  const idsOf = (file) => {
    if (!ids.has(file)) ids.set(file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    return ids.get(file);
  };
  const broken = [];
  let checked = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => m.replace(/>[\s\S]*</, '><'));
    const pageUrl = new URL(`http://site${base}${path.relative(root, page).split(path.sep).join('/')}`);
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const raw = m[1].replace(/&amp;/g, '&');
      if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue; // external, data:, mailto:, …
      const url = new URL(raw, pageUrl);
      const rel = path.relative(root, page);
      checked += 1;
      let pathname = decodeURIComponent(url.pathname);
      if (!pathname.startsWith(base)) {
        broken.push({ from: rel, link: raw, why: 'outside the base' });
        continue;
      }
      let file = path.join(root, pathname.slice(base.length));
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) {
        broken.push({ from: rel, link: raw, why: 'no such file' });
        continue;
      }
      const hash = decodeURIComponent(url.hash.slice(1));
      if (hash && file.endsWith('.html') && !idsOf(file).has(hash)) broken.push({ from: rel, link: raw, why: 'no such anchor' });
    }
  }
  return { pages: pages.length, checked, broken };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  let base = process.env.SITE_BASE || '/';
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base += '/';
  const { pages, checked, broken } = checkLinks(dir, base);
  for (const b of broken.slice(0, 50)) console.log(`BROKEN ${b.from} -> ${b.link} (${b.why})`);
  console.log(`${pages} pages, ${checked} internal links checked, ${broken.length} broken`);
  process.exit(broken.length ? 1 : 0);
}

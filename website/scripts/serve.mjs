#!/usr/bin/env node
// A small static server for the built website, behaving like a static host: correct types (.wasm as application/wasm,
// so the Sheets engine compiles while it streams), a folder's index.html, a redirect from /folder to /folder/, the
// site's 404.html, and immutable caching for content-hashed assets/ files.
//
//   node website/scripts/serve.mjs [dir, default website/dist] [--port 4330]   (SITE_BASE=/sub/ to serve under a base)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.csv': 'text/csv; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

/** Serves `dir` at `base` on `port` (0: any free port); resolves to the listening server. */
export function serve({ dir, port = 4330, host = '127.0.0.1', base = '/' }) {
  const root = path.resolve(dir);
  const send = (res, status, file, extra = {}) => {
    res.writeHead(status, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', ...extra });
    fs.createReadStream(file).pipe(res);
  };
  const notFound = (res) => {
    const page = path.join(root, '404.html');
    if (fs.existsSync(page)) return send(res, 404, page, { 'cache-control': 'no-cache' });
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://site');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return notFound(res);
    }
    if (!pathname.startsWith(base)) return notFound(res);
    let file = path.join(root, pathname.slice(base.length));
    if (file !== root && !file.startsWith(root + path.sep)) return notFound(res);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound(res);
    const hashed = /\/assets\//.test(pathname) && !pathname.endsWith('.html');
    send(res, 200, file, { 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--port');
  const port = at >= 0 ? Number(args.splice(at, 2)[1]) : 4330;
  const dir = args[0] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  let base = process.env.SITE_BASE || '/';
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base += '/';
  const server = await serve({ dir, port, base });
  const { port: p } = server.address();
  console.log(`Serving ${path.resolve(dir)} at http://127.0.0.1:${p}${base}`);
}

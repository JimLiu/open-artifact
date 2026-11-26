# Open Artifact website

The public website: a static marketing and documentation site, plus live in-browser demos of every artifact type. It
is not an npm workspace and is not part of the repo's `npm test`. Each half has its own `package.json` and lockfile.

| Path | What it is |
| --- | --- |
| [`site/`](site/README.md) | The static site, EN and zh-CN (`/zh/…`). A plain Node build script renders the pages, and the docs are read from `../docs` at build time. It also produces `/llms.txt`, `/llms-full.txt`, `/llms/<repo path>`, the sitemap, robots.txt and `404.html`. |
| `playground/` | The live demos. The real Shell (`packages/shell`, built with Vite) runs the real prebuilt editors over an in-memory backend, with a scripted simulated agent. The Docs and Sheets demos run the real engines in the page ([`engines/`](playground/engines/README.md)). |
| `build.mjs` | Builds both halves into `dist/`: the site at the root and the playground under `playground/`. |
| `scripts/` | `serve.mjs` (a static server that behaves like a host), `check-links.mjs` (internal links and anchors), and `verify.mjs` (link check plus the playground's browser checks against `dist/`). |

## Prerequisites

- Node.js 22.18 or later, and a full checkout. The site reads `docs/`, `README.md`, skills and package versions, and
  the playground reads `test-artifacts/`, `e2e/fixtures/` and `packages/` sources.
- The repo itself, installed and built: `npm install && npm run build` at the repo root. The playground copies the
  built editors from `dist/server/editors/`, the design runtime from `dist/server/support.js`, and frame-host's client
  from `dist/daemon/frame-host/client/`. It also uses the root `esbuild` to bundle the engines.
- Each half's dependencies: `npm run setup` here (`npm ci` in `site/` and `playground/`). `build.mjs` runs `npm ci` by
  itself in a half that has no `node_modules`.

## Develop

```bash
cd website/site && npm run dev              # http://localhost:4321, rebuilds and reloads on change
cd website/playground && npm run dev        # http://127.0.0.1:5190; landing at /, a demo at /<type>/
cd website/playground && npm run typecheck  # tsc strict over src/, pages.ts, vite.config.ts and the engines
```

The playground's landing page takes the type colors, icons and mark from `site/src/` and copies the site's tokens
(`playground/src/landing/landing.css`), so it matches the site. Its language follows the site's `oa-lang` choice, then
the site's `/zh/` pages when they linked here, then the browser. The Shell inside a demo follows the browser's language,
as the product does. Each demo page has a one-line bar above the Shell that says it is a live demo with a simulated
agent, and links back to the demos and the site.

Every demo opens at `/playground/<type>/`, which is a real HTML page, so deep links work on any static host.
`demo.html?type=<type>` still works too.

## Build

```bash
node website/build.mjs        # or: cd website && npm run build
```

This writes `website/dist/`, about 48 MB in all, with about 41 MB in `playground/`. Most of the playground is the
prebuilt editors and the Sheets engine's `.wasm`. `SITE_BASE` sets the sub-path the whole site is served from (default
`/`), and the playground is built with `PLAYGROUND_BASE=<SITE_BASE>playground/`. Set `SITE_URL`
(`https://example.org`) to get canonical links and `sitemap.xml`. Each half still builds on its own (`npm run build` in
`site/` or `playground/`). The standalone playground uses a relative base, so it works from any path.

```bash
cd website && npm run verify  # check links and anchors, then run 187 browser checks against dist/ (needs Chrome)
npm run serve                 # serve dist/ at http://127.0.0.1:4330/
```

## Deploy

`website/dist/` is a plain static folder. Publish it as it is.

- **GitHub Pages**: upload `dist/` with `actions/upload-pages-artifact`. It already has `.nojekyll` and `404.html`.
  For a project page, build with `SITE_BASE=/<repo>/`.
- **Cloudflare Pages / Netlify**: set the output directory to `website/dist`. The build writes a `_headers` file that
  caches the content-hashed `assets/` folders (the site's, the playground's, and each editor's) as immutable.
- **Any host**: serve `.wasm` as `application/wasm`, so the Sheets engine compiles while it streams. Cache `assets/`
  files (they are content-hashed) with `Cache-Control: public, max-age=31536000, immutable`, and revalidate HTML.
  Redirect `/folder` to `/folder/`, and serve `404.html` for missing paths.
- **CI** needs a full checkout (not sparse, though shallow is fine), Node 22.18 or later, then `npm ci && npm run
  build` at the repo root, then `node website/build.mjs`. The build reads files from all over the repo, and the
  playground's seed step lists the demo artifacts' files with `git ls-files` (it falls back to walking the folder).

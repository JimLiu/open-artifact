# Open Artifact website (static site)

The marketing site and the documentation for Open Artifact. The output is plain, prerendered HTML in English and
Simplified Chinese (`/zh/…`), with no client framework.

## Commands

```bash
npm install
npm run dev       # build, then serve dist/ at http://localhost:4321 and rebuild + reload on change
npm run build     # write the site to dist/
npm run preview   # serve the built dist/ at http://localhost:4322
```

You need Node.js 22.18 or later. The build reads the repository around it (`../../docs`, `../../README.md`,
`../../skills/open-artifact/SKILL.md`, `../../artifact-types/*/SKILL.md` and `reference/`,
`../../packages/harness-kit/README.md`, and the version in `packages/daemon/package.json`), so build it from a
full checkout.

| Env var | Effect |
| --- | --- |
| `SITE_BASE` | Sub-path the site is served from, such as `/open-artifact/`. The default is `/`. |
| `SITE_URL` | Absolute origin, such as `https://example.org`. When set, the build adds canonical links and writes `sitemap.xml`. |
| `PORT` | Port for `npm run dev`. |

## How it works

`scripts/build.mjs` is a plain Node script. Each page is a function that returns an HTML string. Markdown is rendered
at build time with `marked`, and code is highlighted with `highlight.js`. Vite only serves `dist/` during dev and
preview.

| Path | What it holds |
| --- | --- |
| `src/config.mjs` | Paths, base URL, repository links, and the version. |
| `src/i18n.mjs` | Every UI string, in EN and zh. |
| `src/layout.mjs` | The page shell: head, header, language switch, and footer. |
| `src/components.mjs` | Type cards, install tabs, and copyable commands. |
| `src/data/types.mjs` | The 9 artifact types: colors, features, file tree, exports, and prompts. |
| `src/data/demos.mjs` | The playground's demos: each one's line (the playground's landing page reads it too) and the tab order of the home page's live stage. |
| `src/data/apps.mjs` | Install steps for each agent app, taken from `plugins/*/README.md`. |
| `src/data/docs-manifest.mjs` | Which repository markdown becomes which `/docs/` route, and the sidebar groups. |
| `src/markdown.mjs` | Markdown rendering, heading slugs, link rewriting, and highlighting. |
| `src/pages/*.mjs` | Home, the types index and type pages, install, docs, and 404. |
| `src/assets/` | `site.css` and `site.js`, which get content-hashed into `dist/assets/`. |
| `src/icons.mjs` | The mark, the favicon SVG, the type icons, and the UI icons. |
| `public/` | Static files copied as-is (PNG favicons). |

### Docs

The docs are rendered from the repository's own markdown. Nothing is copied into this folder. For each entry in
`docs-manifest.mjs`, the build looks for `<file>.zh-CN.md`. When that file is missing, the zh page shows the English
text with a note.

Links between `.md` files become site routes. Links to other repository files go to GitHub. A file that has no route
of its own is served raw under `/llms/<repo path>`.

To add a doc, add one entry to `DOC_GROUPS`. To change a type's page, edit `src/data/types.mjs`, and keep it in line
with `artifact-types/<type>/artifact-type.json` and `docs/types/<type>.md`.

### For agents

- `/llms.txt`: an index with a one-line description of every doc.
- `/llms-full.txt`: every English doc in one file.
- `/llms/<repo path>`: each source as raw markdown.

## Output

`dist/` contains `index.html` and `zh/index.html`, then `types/`, `install/` and `docs/` for both languages. It also
has `404.html`, `assets/`, `llms*`, `robots.txt`, `.nojekyll`, and the favicons. `/playground/` is not built
here: `node ../build.mjs` builds this site and the playground (`../playground`) together into `../dist/`. The home
page's live stage frames `/playground/<type>/?embed=1&replay=hold&lang=…` (each demo's replay, then the demo), so it
shows demos only in that combined build (see [`../README.md`](../README.md)).

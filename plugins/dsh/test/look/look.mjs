#!/usr/bin/env node
/**
 * How the plugin's Open Artifact page looks, recorded so that a change meant to leave it as it is can be checked to:
 * the DOM, the computed styles of every element and a screenshot, in a set of cases (a library of every type, pinned
 * and shared ones, missing thumbnails, an empty library, an update on offer, the menus and dialogs), each in four
 * looks (light and dark, with every optional DSH token given or none of them, on macOS or not).
 *
 *   node plugins/dsh/test/look/look.mjs capture <dir> [--only <case>,…]   record every case into <dir>
 *   node plugins/dsh/test/look/look.mjs compare <before> <after>          say what differs between two records
 *
 * `capture` bundles harness.jsx, which applies the plugin's browser half (src/client/index.tsx) to a stand-in for the
 * DSH client context, serves it with the page's routes answered from fixed data (this file), and opens each case in
 * headless Chrome (e2e/lib/browser.mjs). The DSH design tokens (`--dsw-*`, `--dsh-*`) get fixed test values: the light
 * ones on `:root`, the dark ones on `body[data-ds-dark-theme]`, as the app's own themes are. The clock is stopped and
 * animations are off, so two captures of the same code are the same. Chrome comes from E2E_CHROME or the usual places.
 *
 * Not a test of its own (`npm test` does not run it): a tool to run before and after a refactor of the page.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { launch } from '../../../../e2e/lib/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const WIDTH = 1280;
const HEIGHT = 1300;

// ---------------------------------------------------------------- the data the routes answer with

const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const artifact = (id, type, title, over = {}) => ({
  id,
  root: `/Users/look/OpenArtifact/artifacts/${title}`,
  type,
  typeTitle: type.replace(/(^|-)(\w)/g, (_, dash, c) => `${dash ? ' ' : ''}${c.toUpperCase()}`),
  sessionId: '',
  ownerStatus: null,
  title,
  openedAt: ago(2 * HOUR),
  createdAt: ago(40 * DAY),
  updatedAt: ago(3 * HOUR),
  pinned: false,
  shared: false,
  thumbnail: null,
  openable: true,
  viewUrl: `http://127.0.0.1:7777/a/${id}`,
  ...over,
});

const ARTIFACTS = [
  artifact('a-docs', 'docs', 'Q3 product brief', { pinned: true, sessionId: 's1', ownerStatus: 'idle', openedAt: ago(90_000), thumbnail: 'v1' }),
  artifact('a-slides', 'slides', 'Launch keynote', { shared: true, openedAt: ago(3 * HOUR), thumbnail: 'v1' }),
  artifact('a-sheets', 'sheets', 'Budget 2027', { openedAt: ago(26 * HOUR) }),
  artifact('a-design', 'design', 'Landing page', { sessionId: 's2', openedAt: ago(5 * DAY), thumbnail: 'v1' }),
  artifact('a-ds', 'design-system', 'Brand kit', { shared: true, openedAt: ago(9 * DAY) }),
  artifact('a-data', 'data', 'Revenue dashboard', { pinned: true, openedAt: ago(20 * DAY) }),
  artifact('a-wb', 'whiteboard', 'Onboarding flow', { openedAt: ago(45 * DAY) }),
  artifact('a-motion', 'motion', 'Product teaser', { openedAt: ago(70 * DAY) }),
  artifact('a-page', 'page', 'Legacy notes', { openable: false, typeTitle: 'Page', openedAt: ago(400 * DAY) }),
  artifact('a-broken', 'docs', 'A thumbnail that no longer loads', { thumbnail: 'gone', openedAt: ago(6 * MIN) }),
  artifact('a-long', 'slides', 'A very long title that goes on and on past the edge of its card and then some more', { openedAt: ago(14 * MIN) }),
];

const TYPES = [
  ['slides', 'Slides', 'Decks'],
  ['design', 'Design', 'Screens'],
  ['design-system', 'Design System', 'Tokens'],
  ['data', 'Data', 'Dashboards'],
  ['docs', 'Docs', 'Documents'],
  ['motion', 'Motion', 'Animations'],
  ['whiteboard', 'Whiteboard', 'Boards'],
  ['sheets', 'Sheets', 'Spreadsheets'],
].map(([id, title, description]) => ({ id, title, description }));

const OFFER = { name: 'dsh-open-artifact', version: '0.14.6', latest: '0.15.0', spec: 'https://registry.example/dsh-open-artifact-0.15.0.tgz', registry: 'https://registry.example/', enabled: true, native: false };

const release = (version, date, summary, sections) => ({ version, date, summary, sections });
const RELEASES = [
  release('0.14.6', '2026-11-19', ['The page says when the app keeps a page out of the card, with `code` and **bold** in it.'], [
    { title: 'Added', items: ['A [link to the notes](https://example.com/notes) in an item', 'A second item that goes on long enough to wrap onto another line in the panel', 'A third item'] },
    { title: 'Fixed', items: ['A fix', 'Another fix'] },
  ]),
  release('0.14.5', '2026-11-12', ['Artboard errors at the top right.'], [{ title: 'Changed', items: ['Something changed'] }, { title: 'Removed', items: ['Something went'] }]),
];
const UPCOMING = [release('0.15.0', '2026-11-24', ['Desktop app groundwork.'], [{ title: 'Added', items: ['New thing one', 'New thing two'] }])];

// ---------------------------------------------------------------- the cases

/**
 * Each case: what the routes answer (`list`: 'ok', 'hang' or 'error'; `artifacts`; `offer`), what is in localStorage
 * before the page starts, what has to be on the page before anything is done (`ready`), and what is then done.
 */
const base = { list: 'ok', artifacts: ARTIFACTS, offer: true, canCreate: true, storage: { 'open-artifact.changelog.seen': '0.14.6' } };
const updated = '[data-testid=open-artifact-update] .oa-news-upcoming';
const CASES = {
  grid: { ...base, ready: `${updated} && .oa-foot && .oa-grid` },
  list: { ...base, storage: { ...base.storage, 'open-artifact.view': 'list' }, ready: `${updated} && .oa-list` },
  narrow: { ...base, width: 520, storage: { ...base.storage, 'open-artifact.view': 'list' }, ready: `${updated} && .oa-list` },
  empty: { ...base, artifacts: [], offer: false, storage: {}, ready: '[data-testid=open-artifact-whats-new] && .oa-empty && .oa-foot' },
  dismissed: { ...base, storage: { ...base.storage, 'open-artifact.update.dismissed': '0.15.0' }, ready: '[data-testid=open-artifact-update-line] && .oa-grid' },
  loading: { ...base, list: 'hang', offer: false, ready: '.oa-skeleton && .oa-foot' },
  error: { ...base, list: 'error', offer: false, ready: '.oa-empty[role=alert] && .oa-foot' },
  nocreate: { ...base, offer: false, canCreate: false, ready: '.oa-grid && .oa-foot' },
  search: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ click: '.oa-tool[aria-label="Search artifacts"]' }, { wait: '.oa-search input' }, { type: 'brief' }], then: '.oa-search button' },
  nomatch: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ click: '.oa-tool[aria-label="Search artifacts"]' }, { wait: '.oa-search input' }, { type: 'zzzz' }], then: '.oa-empty' },
  filtermenu: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ click: '.oa-tool[aria-haspopup=menu]' }, { wait: '.oa-menu' }, { clickText: ['.oa-menu-item', 'Type'] }], then: '.oa-submenu' },
  filtered: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ click: '.oa-tool[aria-haspopup=menu]' }, { wait: '.oa-menu' }, { clickText: ['.oa-menu-item', 'Pinned'] }, { key: 'Escape' }], then: '.oa-tool[data-active=true]' },
  actions: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ click: '.oa-item .oa-act[aria-haspopup=menu]' }], then: '.oa-menu' },
  create: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ click: '.oa-tool[aria-label="New"]' }], then: '.oa-menu' },
  rename: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ click: '.oa-item .oa-act[aria-haspopup=menu]' }, { wait: '.oa-menu' }, { clickText: ['.oa-menu-item', 'Rename'] }], then: '.oa-dialog input' },
  delete: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ click: '.oa-item .oa-act[aria-haspopup=menu]' }, { wait: '.oa-menu' }, { clickText: ['.oa-menu-item', 'Delete'] }], then: '.oa-dialog .oa-btn[data-danger=true]' },
  deleted: {
    ...base,
    offer: false,
    ready: '.oa-grid && .oa-foot',
    act: [{ click: '.oa-item .oa-act[aria-haspopup=menu]' }, { wait: '.oa-menu' }, { clickText: ['.oa-menu-item', 'Delete'] }, { wait: '.oa-dialog' }, { click: '.oa-dialog .oa-btn[data-danger=true]' }],
    then: '.oa-toast .oa-toast-undo',
  },
  changelog: { ...base, ready: `${updated} && .oa-foot`, act: [{ click: '[data-testid=open-artifact-changelog]' }], then: '.oa-changelog .oa-release' },
  peek: { ...base, offer: false, ready: '.oa-grid && .oa-foot', act: [{ hover: '.oa-tile[data-type=design]' }], then: '[data-testid=open-artifact-peek]' },
};

/** The four looks: the theme, every optional token given or none, macOS or not. */
const LOOKS = {
  light: { dark: false, bare: false, darwin: false },
  'light-bare-darwin': { dark: false, bare: true, darwin: true },
  dark: { dark: true, bare: false, darwin: false },
  'dark-bare-darwin': { dark: true, bare: true, darwin: true },
};

const LIGHT = {
  '--dsw-alias-label-primary': '#1a1a1a',
  '--dsw-alias-label-secondary': '#4d4d4d',
  '--dsw-alias-label-tertiary': '#7a7a7a',
  '--dsw-alias-label-caption': '#a3a3a3',
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-interactive-bg-hover': '#efefef',
  '--dsw-alias-state-business-primary': '#3b6cf6',
  '--dsw-alias-state-error-primary': '#e5484d',
  '--dsw-alias-border-l1': '#c8c8c8',
  '--dsw-alias-border-l2': '#e2e2e2',
  '--dsw-alias-markdown-code-block': '#f6f6f6',
};
const LIGHT_OPTIONAL = {
  '--dsw-alias-border-l4': '#b0b0b0',
  '--dsw-alias-bg-skeleton': '#e9e9e9',
  '--dsw-focus-ring-width': '3px',
  '--dsw-focus-ring-color': '#ff8800',
  '--dsh-frame-top-clearance': '14px',
};
const DARK = {
  '--dsw-alias-label-primary': '#f2f2f2',
  '--dsw-alias-label-secondary': '#c4c4c4',
  '--dsw-alias-label-tertiary': '#9a9a9a',
  '--dsw-alias-label-caption': '#6e6e6e',
  '--dsw-alias-bg-base': '#17181a',
  '--dsw-alias-interactive-bg-hover': '#2a2b2e',
  '--dsw-alias-state-business-primary': '#6e93ff',
  '--dsw-alias-state-error-primary': '#ff6b6b',
  '--dsw-alias-border-l1': '#4a4a4a',
  '--dsw-alias-border-l2': '#333336',
  '--dsw-alias-markdown-code-block': '#222326',
};
const DARK_OPTIONAL = {
  '--dsw-alias-border-l4': '#555559',
  '--dsw-alias-bg-skeleton': '#222224',
  '--dsw-focus-ring-width': '3px',
  '--dsw-focus-ring-color': '#ffaa33',
  '--dsh-frame-top-clearance': '18px',
};

const declarations = (tokens) =>
  Object.entries(tokens)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');

/** The look's own CSS: the tokens, and a still page (no animations, no caret). */
function lookCss({ bare }) {
  return [
    `:root{${declarations({ ...LIGHT, ...(bare ? {} : LIGHT_OPTIONAL) })}}`,
    `body[data-ds-dark-theme]{${declarations({ ...DARK, ...(bare ? {} : DARK_OPTIONAL) })}}`,
    'html,body{margin:0;height:100%}',
    'body{font:14px/1.5 Helvetica,Arial,sans-serif;background:#808080}',
    '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}',
    '#outside{box-sizing:border-box;height:72px;display:flex;align-items:center;padding:0 12px;border-bottom:1px solid #666}',
    '.look-outside{display:flex;align-items:center;gap:16px}',
    '.look-row{display:flex;align-items:center;gap:8px;width:260px;height:36px;padding:0 10px;border:1px solid #666;background:#fff;text-align:left}',
    '.look-rail{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid #666;background:#fff}',
    '.look-detail{display:flex;align-items:center;gap:8px}',
    '#main{height:calc(100vh - 72px)}',
  ].join('\n');
}

function pageHtml(name, lookName) {
  const c = CASES[name];
  const l = LOOKS[lookName];
  const setup = {
    canCreate: c.canCreate,
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${name} ${lookName}</title>
<style>${lookCss(l)}</style>
<script>
Date.now = () => ${NOW};
try { localStorage.clear(); ${Object.entries(c.storage)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join(' ')} } catch {}
window.__LOOK__ = ${JSON.stringify(setup)};
</script>
</head><body${l.dark ? ' data-ds-dark-theme=""' : ''}${l.darwin ? ' data-platform="darwin"' : ''}>
<div id="outside"></div><div id="main"></div>
<script src="/bundle.js"></script>
</body></html>`;
}

// ---------------------------------------------------------------- the server

/** A thumbnail: a drawing in the artifact's own colors, the same each time. */
function thumbnail(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="450" viewBox="0 0 720 450"><rect width="720" height="450" fill="hsl(${hash} 60% 92%)"/><rect x="48" y="48" width="400" height="36" rx="6" fill="hsl(${hash} 50% 40%)"/><rect x="48" y="112" width="624" height="14" rx="4" fill="hsl(${hash} 20% 70%)"/><rect x="48" y="142" width="560" height="14" rx="4" fill="hsl(${hash} 20% 70%)"/><circle cx="600" cy="320" r="80" fill="hsl(${(hash + 120) % 360} 55% 60%)"/></svg>`;
}

function serve(bundle) {
  const held = new Set();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://look');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (status, type, body) => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(body);
    };
    const json = (body, status = 200) => send(status, 'application/json', JSON.stringify(body));
    if (url.pathname === '/bundle.js') return send(200, 'text/javascript', bundle);
    // /p/<case>/<look>/ and its routes: /p/<case>/<look>/api/open-artifact.artifacts…
    if (parts[0] !== 'p' || !CASES[parts[1]] || !LOOKS[parts[2]]) return send(404, 'text/plain', 'not here');
    const c = CASES[parts[1]];
    if (parts.length === 3) return send(200, 'text/html', pageHtml(parts[1], parts[2]));
    const route = parts.slice(3).join('/');
    const base = 'api/open-artifact.artifacts';
    if (route === base) {
      if (c.list === 'hang') return void held.add(response);
      if (c.list === 'error') return json({ error: 'the daemon is not answering' }, 502);
      return json({ artifacts: c.artifacts, types: TYPES });
    }
    if (route === `${base}.updates`) return json({ updates: c.offer ? [OFFER] : [], failed: [] });
    if (route === `${base}.changelog`) return json({ version: '0.14.6', releases: RELEASES, upcoming: url.searchParams.get('upcoming') === '1' && c.offer ? UPCOMING : [] });
    if (route === `${base}.thumbnail`) {
      const v = url.searchParams.get('v');
      if (v === 'gone') return send(404, 'application/json', '{"error":"no thumbnail yet"}');
      return send(200, 'image/svg+xml', thumbnail(url.searchParams.get('id') ?? ''));
    }
    if (route === `${base}.events` || route === `${base}.host-opens`) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      response.write(': open\n\n');
      return void held.add(response);
    }
    if (route === `${base}.delete`) return json({ trash: 'trash-1', path: '' });
    if (route === `${base}.update`) return json(c.artifacts.find((a) => a.id === url.searchParams.get('id')) ?? {});
    return json({ error: `no route ${route}` }, 404);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => {
          for (const r of held) r.destroy();
          server.close();
        },
      }),
    );
  });
}

// ---------------------------------------------------------------- what is recorded

const PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing', 'width', 'height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'color', 'background-color', 'background-image', 'box-shadow', 'opacity', 'visibility', 'transform', 'filter',
  'outline-color', 'outline-style', 'outline-width', 'outline-offset',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'white-space', 'text-overflow',
  'overflow-x', 'overflow-y', 'gap', 'flex-direction', 'align-items', 'justify-content', 'aspect-ratio', 'object-fit',
  'fill', 'stroke', 'stroke-width',
];
const PSEUDO_PROPS = ['content', 'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'background-color', 'border-top-left-radius', 'opacity', 'transform', 'box-shadow'];

/** Run in the page: the DOM of #outside and #main as text, every element's computed style, the classes seen. */
const DUMP = `(() => {
  const PROPS = ${JSON.stringify(PROPS)};
  const PSEUDO = ${JSON.stringify(PSEUDO_PROPS)};
  const dom = [];
  const styles = {};
  const classes = new Set();
  const walk = (node, depth, path) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\\s+/g, ' ').trim();
      if (text) dom.push('  '.repeat(depth) + JSON.stringify(text));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const attrs = [...node.attributes].map((a) => a.name + '=' + JSON.stringify(a.value)).sort();
    dom.push('  '.repeat(depth) + '<' + node.tagName.toLowerCase() + (attrs.length ? ' ' + attrs.join(' ') : '') + '>');
    const cls = typeof node.className === 'string' ? node.className : node.getAttribute('class') || '';
    for (const c of cls.split(/\\s+/)) if (c) classes.add(c);
    const s = getComputedStyle(node);
    const entry = { tag: node.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\\s+/).join('.') : ''), style: PROPS.map((p) => s.getPropertyValue(p)) };
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(node, pseudo);
      if (ps.content && ps.content !== 'none' && ps.content !== 'normal') entry[pseudo] = PSEUDO.map((p) => ps.getPropertyValue(p));
    }
    styles[path] = entry;
    [...node.childNodes].forEach((child, i) => walk(child, depth + 1, path + '/' + i));
  };
  walk(document.getElementById('outside'), 0, 'outside');
  walk(document.getElementById('main'), 0, 'main');
  const sheets = [...document.querySelectorAll('style[data-plugin-css]')].map((s) => s.dataset.pluginCss);
  return { dom: dom.join('\\n'), styles, classes: [...classes].sort(), sheets, focus: document.activeElement ? document.activeElement.tagName + '.' + document.activeElement.className : '' };
})()`;

// ---------------------------------------------------------------- capture

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTrue = (selectors) => selectors.split(' && ').map((s) => `document.querySelector(${JSON.stringify(s)})`).join(' && ');

async function runAct(page, step) {
  if (step.wait) {
    if (!(await page.waitFor(isTrue(step.wait), 10_000))) throw new Error(`never showed: ${step.wait}`);
  } else if (step.click) {
    await page.evaluate(`document.querySelector(${JSON.stringify(step.click)}).click()`);
  } else if (step.clickText) {
    const [selector, text] = step.clickText;
    await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => (e.querySelector('.oa-menu-label') ?? e).textContent.trim() === ${JSON.stringify(text)}).click()`);
  } else if (step.type) {
    await page.type(step.type);
  } else if (step.key) {
    await page.press(step.key);
  } else if (step.hover) {
    const box = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(step.hover)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page.hover(box.x, box.y);
  }
  await sleep(150);
}

async function capture(out, only) {
  const bundle = buildSync({
    entryPoints: [join(here, 'harness.jsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    charset: 'utf8',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text;
  const server = await serve(bundle);
  const browser = await launch({ width: WIDTH, height: HEIGHT });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const problems = [];
  try {
    for (const name of Object.keys(CASES)) {
      if (only && !only.includes(name)) continue;
      const c = CASES[name];
      for (const lookName of Object.keys(LOOKS)) {
        const id = `${name}--${lookName}`;
        const page = await browser.load(`${server.url}/p/${name}/${lookName}/`, { ready: 'window.__LOOK_READY__ === true', settle: 100 });
        try {
          await page.cdp('Emulation.setDeviceMetricsOverride', { width: c.width ?? WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
          const ready = `${isTrue(c.ready)} && [...document.images].every((i) => i.complete)`;
          if (!(await page.waitFor(ready, 15_000))) throw new Error(`${id}: never ready: ${c.ready}`);
          await sleep(300);
          for (const step of c.act ?? []) await runAct(page, step);
          if (c.then && !(await page.waitFor(isTrue(c.then), 10_000))) throw new Error(`${id}: never showed: ${c.then}`);
          await sleep(500);
          const dump = await page.evaluate(DUMP);
          const shot = await page.cdp('Page.captureScreenshot', { format: 'png' });
          mkdirSync(join(out, id), { recursive: true });
          writeFileSync(join(out, id, 'dom.txt'), `${dump.dom}\n`);
          writeFileSync(join(out, id, 'styles.json'), JSON.stringify({ props: PROPS, pseudo: PSEUDO_PROPS, elements: dump.styles }));
          writeFileSync(join(out, id, 'meta.json'), JSON.stringify({ classes: dump.classes, sheets: dump.sheets, focus: dump.focus }, null, 2));
          writeFileSync(join(out, id, 'shot.png'), Buffer.from(shot.data, 'base64'));
          const seen = page.problems.filter((p) => !/the daemon is not answering|502|404/.test(p));
          if (seen.length) problems.push(`${id}: ${seen.join('; ')}`);
          console.log(`look: ${id}`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(join(out, 'problems.txt'), problems.join('\n'));
  if (problems.length) console.log(`look: problems on the pages:\n${problems.join('\n')}`);
}

// ---------------------------------------------------------------- compare

async function compare(a, b) {
  const ids = [...new Set([...readdirSync(a), ...readdirSync(b)])].filter((n) => existsSync(join(a, n, 'dom.txt')) || existsSync(join(b, n, 'dom.txt'))).sort();
  const report = [];
  const shots = [];
  const classesSeen = new Set();
  for (const id of ids) {
    if (!existsSync(join(a, id, 'dom.txt')) || !existsSync(join(b, id, 'dom.txt'))) {
      report.push(`${id}: only in ${existsSync(join(a, id, 'dom.txt')) ? 'the first' : 'the second'}`);
      continue;
    }
    for (const c of JSON.parse(readFileSync(join(b, id, 'meta.json'), 'utf8')).classes) classesSeen.add(c);
    const domA = readFileSync(join(a, id, 'dom.txt'), 'utf8').split('\n');
    const domB = readFileSync(join(b, id, 'dom.txt'), 'utf8').split('\n');
    if (domA.length !== domB.length) report.push(`${id}: DOM has ${domA.length} lines, then ${domB.length}`);
    else domA.forEach((line, i) => line !== domB[i] && report.push(`${id}: DOM line ${i + 1}\n    - ${line.trim()}\n    + ${domB[i].trim()}`));
    const sa = JSON.parse(readFileSync(join(a, id, 'styles.json'), 'utf8'));
    const sb = JSON.parse(readFileSync(join(b, id, 'styles.json'), 'utf8'));
    for (const path of new Set([...Object.keys(sa.elements), ...Object.keys(sb.elements)])) {
      const ea = sa.elements[path];
      const eb = sb.elements[path];
      if (!ea || !eb) {
        report.push(`${id}: ${path} only in ${ea ? 'the first' : 'the second'}`);
        continue;
      }
      sa.props.forEach((prop, i) => ea.style[i] !== eb.style[i] && report.push(`${id}: ${path} ${ea.tag} ${prop}: ${ea.style[i]} -> ${eb.style[i]}`));
      for (const pseudo of ['::before', '::after']) {
        if (JSON.stringify(ea[pseudo]) !== JSON.stringify(eb[pseudo])) report.push(`${id}: ${path} ${ea.tag}${pseudo}: ${JSON.stringify(ea[pseudo])} -> ${JSON.stringify(eb[pseudo])}`);
      }
    }
    const pa = readFileSync(join(a, id, 'shot.png'));
    const pb = readFileSync(join(b, id, 'shot.png'));
    if (!pa.equals(pb)) shots.push({ id, a: pa.toString('base64'), b: pb.toString('base64') });
  }
  if (shots.length) {
    const browser = await launch({ width: 400, height: 300 });
    try {
      const page = await browser.load('about:blank');
      for (const { id, a: da, b: db } of shots) {
        const differ = await page.evaluate(`(async () => {
          const load = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
          const [x, y] = await Promise.all([load('data:image/png;base64,${da}'), load('data:image/png;base64,${db}')]);
          if (x.width !== y.width || x.height !== y.height) return 'size ' + x.width + 'x' + x.height + ' -> ' + y.width + 'x' + y.height;
          const pixels = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
          const p = pixels(x), q = pixels(y);
          let n = 0; for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i+1] !== q[i+1] || p[i+2] !== q[i+2] || p[i+3] !== q[i+3]) n++;
          return n;
        })()`);
        if (differ !== 0) report.push(`${id}: screenshot: ${typeof differ === 'number' ? `${differ} pixels differ` : differ}`);
      }
    } finally {
      await browser.close();
    }
  }
  console.log(`look: compared ${ids.length} captures; ${report.length === 0 ? 'no differences' : `${report.length} differences`}`);
  for (const line of report) console.log(line);
  return { report, classesSeen: [...classesSeen].sort() };
}

// ---------------------------------------------------------------- main

const [command, first, second, ...rest] = process.argv.slice(2);
if (command === 'capture' && first) {
  const at = rest.indexOf('--only');
  const flag = second === '--only' ? rest[0] : at >= 0 ? rest[at + 1] : undefined;
  await capture(first, flag?.split(','));
} else if (command === 'compare' && first && second) {
  const { report, classesSeen } = await compare(first, second);
  writeFileSync(join(second, 'classes-seen.txt'), `${classesSeen.join('\n')}\n`);
  process.exitCode = report.length === 0 ? 0 : 1;
} else {
  console.error('usage: look.mjs capture <dir> [--only <case>,…] | look.mjs compare <before> <after>');
  process.exitCode = 2;
}

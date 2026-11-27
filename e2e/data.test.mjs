// End-to-end tests of the data type's command line: the fixture dashboard (fixtures/data) is written through write-db
// and passes check, also with the token names of claude.ai's dashboards; a broken copy of each kind fails it with the
// finding the page would show; write-db refuses what the page would drop and writes nothing; history leaves out
// dash/settings; upload, read-db --text and delete-asset; open, wait and stop. In a browser: what a guest's page may
// save (a commenter only their own folder), the read-only embedded view of a dashboard another page frames through the
// Shell, the empty dashboard's format picker and file import, and claude.ai's token names drawing as the dashboard's
// own tokens in light, dark and under a look.
// The sources: their count on the Sources button, a linked source's Open in its host, the CSV download's byte order
// mark and the failure notice's link to what didn’t load. Restoring an earlier version from History. The card of a
// page link that leads away, the Corners field read out at its bound, and the pencil only with a page to edit.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { cli, run } from './lib/cli.mjs';
import { until } from './lib/http.mjs';
import { browserOff, fixtures, install, removeTmp, tmpDir, typePath } from './lib/target.mjs';
import { writeTestConnectors } from '../test-artifacts/test-connectors.mjs';

const T = { timeout: 90000 };
const TYPE = 'data';

function skip() {
  const dir = typePath(TYPE);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return `${TYPE} is not in ${dir}`;
  const missing = ['scripts/cli.mjs', 'scripts/editors/data/index.html'].filter(f => !fs.existsSync(path.join(dir, f)));
  return missing.length ? `${TYPE} is not built (npm run build): no ${missing.join(', ')}` : false;
}

const docPath = (root, doc) => path.join(root, 'db', `${doc}.json`);
const readDoc = (root, doc) => JSON.parse(fs.readFileSync(docPath(root, doc), 'utf8'));
const writeDoc = (root, doc, value) => {
  fs.mkdirSync(path.dirname(docPath(root, doc)), { recursive: true });
  fs.writeFileSync(docPath(root, doc), typeof value === 'string' ? value : JSON.stringify(value));
};
const findingsOf = out => out.json.findings.map(f => `${f.level} ${f.file.replace(/^db\//, '').replace(/\.json$/, '')} ${f.message}`);

describe(TYPE, { skip: skip() }, () => {
  const ctx = {};

  /** A copy of the loaded fixture dashboard. */
  const copy = label => {
    const root = path.join(tmpDir(`data-${label}`), 'dashboard');
    fs.cpSync(ctx.root, root, { recursive: true });
    return root;
  };

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    const home = tmpDir('data-home');
    ctx.connectors = path.join(home, 'connectors.json');
    fs.writeFileSync(ctx.connectors, JSON.stringify({ mcpServers: { sales: { command: 'true' } } }));
    ctx.cli = cli(dir, {
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-state'), 'state'),
      HOME: home,
      OPEN_ARTIFACT_USER: 'E2E',
      OPEN_ARTIFACT_CONNECTORS: ctx.connectors,
    });
    ctx.root = path.join(tmpDir('data-root'), 'dashboard');
    const load = await run(path.join(fixtures, 'data', 'load.mjs'), [ctx.cli.script, ctx.root], { env: ctx.cli.env() });
    assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
  });

  after(async () => {
    await ctx.cli?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('check passes the fixture, warning only of the dataset nothing names', T, async () => {
    const out = await ctx.cli.run(['check', ctx.root, '--json']);
    assert.equal(out.code, 0, out.stdout);
    assert.equal(out.json.type, TYPE);
    assert.deepEqual(findingsOf(out), ['warning datasets/unused nothing on the page names it; Sources labels it "Unused".']);
  });

  it('check passes a page written with the token names of the dashboards on claude.ai', T, async () => {
    const root = copy('claude-tokens');
    const css = readDoc(root, 'files/app.css');
    css.text += '\n.claude { padding: var(--cds-pad-lg); gap: var(--cds-gap-md); border-radius: var(--cds-radius); font-family: var(--font-anthropic-serif); color: var(--cds-chart-status-critical); }';
    writeDoc(root, 'files/app.css', css);
    const out = await ctx.cli.run(['check', root, '--json']);
    assert.equal(out.code, 0, out.stdout);
    assert.deepEqual(findingsOf(out), ['warning datasets/unused nothing on the page names it; Sources labels it "Unused".']);
  });

  it('check says when a live query names a connector the owner has not set up', T, async () => {
    const out = await ctx.cli.run(['check', ctx.root, '--json'], { env: { OPEN_ARTIFACT_CONNECTORS: path.join(path.dirname(ctx.connectors), 'none.json') } });
    assert.equal(out.code, 0, out.stdout);
    const warnings = findingsOf(out).filter(line => line.includes('there is no connectors.json'));
    assert.deepEqual(warnings.map(line => line.split(' ')[1]), ['datasets/broken', 'datasets/orders', 'datasets/tickets']);
  });

  const broken = {
    'a file without updated': [root => { const d = readDoc(root, 'datasets/signups'); delete d.updated; writeDoc(root, 'datasets/signups', d); }, 'error datasets/signups needs updated'],
    'an old rows dataset': [root => writeDoc(root, 'datasets/old', { title: 'Old', source: { kind: 'rows', rows: [] } }), 'error datasets/old is an old rows dataset'],
    'a url that is no upload': [root => { const d = readDoc(root, 'datasets/signups'); d.source.url = 'https://example.com/a.csv'; writeDoc(root, 'datasets/signups', d); }, 'error datasets/signups source.url "https://example.com/a.csv" isn’t an attached file'],
    'a filter with no rule': [root => { const d = readDoc(root, 'datasets/orders'); delete d.source.rules; writeDoc(root, 'datasets/orders', d); }, 'error datasets/orders {{region}} is written into the query’s text with no rule'],
    'a rule with a word it does not know': [root => { const d = readDoc(root, 'datasets/orders'); d.source.rules.region.bogus = 1; writeDoc(root, 'datasets/orders', d); }, 'error datasets/orders source.rules are refused'],
    'a look with no set': [root => writeDoc(root, 'dash/look', { corners: '8px' }), 'error dash/look has no set the dashboard can use'],
    'a file named without its format': [root => { const d = readDoc(root, 'datasets/signups'); d.source.name = 'signups'; delete d.source.format; writeDoc(root, 'datasets/signups', d); }, 'warning datasets/signups source.format is left out'],
    'a mark of no dataset': [root => { const d = readDoc(root, 'files/index.html'); d.text += '\n<b data-source="nosuch" data-field="x">1</b>'; writeDoc(root, 'files/index.html', d); }, 'error files/index.html <b>: data-source="nosuch" names no dataset or dash.calc'],
    'a dataset read but not marked': [root => { const d = readDoc(root, 'files/app.js'); d.text += '\ndash.data("unused");'; writeDoc(root, 'files/app.js', d); }, 'error datasets/unused files/app.js reads it, but no element is marked'],
    'a token that does not exist': [root => { const d = readDoc(root, 'files/app.css'); d.text += '\n.x { color: var(--dash-nope); }'; writeDoc(root, 'files/app.css', d); }, 'error files/index.html var(--dash-nope) is no token of the dashboard'],
    'a claude.ai token with nothing behind it here': [root => { const d = readDoc(root, 'files/app.css'); d.text += '\n.x { color: var(--cds-text-accent); }'; writeDoc(root, 'files/app.css', d); }, 'error files/index.html var(--cds-text-accent) is no token of the dashboard: of the claude.ai names'],
    'no dash/meta': [root => fs.rmSync(docPath(root, 'dash/meta')), 'error dash/meta is missing'],
    'saved rows kept outside data/': [root => writeDoc(root, 'datasets/notes', { title: 'Notes', source: { kind: 'store', path: 'notes/all' } }), 'error datasets/notes source.path "notes/all" isn’t under data/'],
    'saved rows in a person’s own reports': [root => writeDoc(root, 'datasets/notes', { title: 'Notes', source: { kind: 'store', path: 'data/users/me/check' } }), 'error datasets/notes source.path "data/users/me/check" is one of the page’s own reports'],
    'a page that failed in the owner’s browser': [
      root => writeDoc(root, 'data/users/owner/check', { v: 1, status: 'failed', at: Date.now(), page: [{ kind: 'error', name: 'TypeError', message: 'x', file: 'app.js', count: 1 }] }),
      'error data/users/owner/check the page\'s code threw: TypeError in app.js',
    ],
  };
  for (const [name, [edit, expected]] of Object.entries(broken))
    it(`check names ${name}`, T, async () => {
      const root = copy(name.replace(/[^a-z]+/gi, '-'));
      edit(root);
      const out = await ctx.cli.run(['check', root, '--json']);
      assert.ok(out.json, out.stdout + out.stderr);
      assert.equal(out.code, expected.startsWith('error') ? 1 : 0, out.stdout);
      assert.ok(findingsOf(out).some(line => line.startsWith(expected)), `${expected}\nnot in:\n${findingsOf(out).join('\n')}`);
    });

  it('check passes saved rows read and marked by the page before any row exists, and a form that saves them', T, async () => {
    const root = copy('saved-rows');
    writeDoc(root, 'datasets/notes', { title: 'Notes', source: { kind: 'store', path: 'data/users/me/notes/items' } });
    const page = readDoc(root, 'files/index.html');
    page.text += '\n<form id="note-form"><input name="text"><button>Save</button></form>\n<ul id="notes" data-source="notes"></ul>';
    writeDoc(root, 'files/index.html', page);
    const app = readDoc(root, 'files/app.js');
    app.text += '\ndash.onData(() => { const notes = dash.data("notes"); document.getElementById("notes").textContent = String(notes.rows.length); });';
    writeDoc(root, 'files/app.js', app);
    const out = await ctx.cli.run(['check', root, '--json']);
    assert.equal(out.code, 0, out.stdout);
    const about = findingsOf(out).filter(line => line.includes('notes') || line.includes('form'));
    assert.deepEqual(about, [], about.join('\n'));
  });

  it('write-db keeps shared saved rows and read-db lists them', T, async () => {
    const root = copy('saved-rows-write');
    await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'set', path: 'data/team/notes/n1', data: { text: 'hi' } }])]);
    assert.deepEqual(readDoc(root, 'data/team/notes/n1'), { text: 'hi' });
    const listed = await ctx.cli.json(['read-db', root, 'data/team/notes']);
    assert.ok(JSON.stringify(listed).includes('"hi"'), JSON.stringify(listed));
  });

  const refused = {
    'a person’s own document': [[{ op: 'set', path: 'data/users/owner/check', data: {} }], 'READ_ONLY_PATH'],
    'a dataset id the page ignores': [[{ op: 'set', path: 'dash/params', data: { region: 'North' } }, { op: 'set', path: 'datasets/a.b', data: { title: 'x' } }], 'REFUSED'],
    'a page file without its text': [[{ op: 'set', path: 'files/extra.js', data: { body: '' } }], 'REFUSED'],
    'a page file over 256 KB': [[{ op: 'set', path: 'files/extra.js', data: { text: 'x'.repeat(300 * 1024) } }], 'TOO_LARGE'],
  };
  for (const [name, [writes, code]] of Object.entries(refused))
    it(`write-db refuses ${name} and writes nothing`, T, async () => {
      const root = copy('refused');
      const before = fs.readFileSync(docPath(root, 'dash/params'), 'utf8');
      const out = await ctx.cli.run(['write-db', root, JSON.stringify(writes)]);
      assert.equal(out.code, 1, out.stdout);
      assert.equal(out.json?.error, code, out.stdout);
      assert.match(out.json.message, /Nothing was written\.$/);
      assert.equal(fs.readFileSync(docPath(root, 'dash/params'), 'utf8'), before);
      assert.ok(!fs.existsSync(docPath(root, 'files/extra.js')) && !fs.existsSync(docPath(root, 'data/users/owner/check')));
    });

  it('write-db starts a dashboard in an empty folder from its dash/meta, and update removes a key with __delete__', T, async () => {
    const root = path.join(tmpDir('data-new'), 'dashboard');
    const first = await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'set', path: 'dash/meta', data: { title: 'New' } }])]);
    assert.equal(first.writes[0].created, true);
    const refusedRoot = path.join(tmpDir('data-none'), 'dashboard');
    const none = await ctx.cli.run(['write-db', refusedRoot, JSON.stringify([{ op: 'set', path: 'notes/a', data: {} }])]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /not a db-backed artifact/);
    await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'update', path: 'dash/meta', data: { title: { __delete__: true }, lang: 'en' } }])]);
    assert.deepEqual(readDoc(root, 'dash/meta'), { lang: 'en' });
  });

  it('history keeps no version for a change to dash/settings alone, and one for dash/meta', T, async () => {
    const root = copy('history');
    const paths = out => out.versions.flatMap(version => version.files.map(file => file.path));
    const before = await ctx.cli.json(['history', root, '--json']);
    assert.ok(fs.existsSync(docPath(root, 'dash/settings')), 'the fixture writes dash/settings');
    assert.ok(!paths(before).some(p => p.includes('dash/settings')), paths(before).join(', '));
    await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'set', path: 'dash/settings', data: { updates: 'day' } }])]);
    const settings = await ctx.cli.json(['history', root, '--json']);
    assert.deepEqual(settings.versions.map(version => version.n), before.versions.map(version => version.n));
    await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'update', path: 'dash/meta', data: { title: 'Renamed' } }])]);
    const meta = await ctx.cli.json(['history', root, '--json']);
    assert.equal(meta.versions.length, before.versions.length + 1);
    assert.deepEqual(meta.versions[0].files.map(file => file.path), ['db/dash/meta']);
  });

  it('upload stores a file under a name, read-db --text prints a page file, delete-asset refuses an upload in use', T, async () => {
    const root = copy('uploads');
    const src = path.join(tmpDir('data-src'), 'rows');
    fs.writeFileSync(src, 'a,b\n1,2\n');
    const up = await ctx.cli.run(['upload', root, src, '--name', 'rows.csv']);
    assert.equal(up.code, 0, up.stderr);
    const [url, type, size, name] = up.stdout.trim().split('\t');
    assert.match(url, /^\/_blob\/[0-9a-f]{32}$/);
    assert.deepEqual([type, size, name], ['text/csv', '8', 'rows.csv']);
    const missing = await ctx.cli.run(['upload', root, `${src}.gone`]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /No such file/);

    const text = await ctx.cli.run(['read-db', root, 'files/index.html', '--text']);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout, readDoc(root, 'files/index.html').text);
    const notText = await ctx.cli.run(['read-db', root, 'dash/meta', '--text']);
    assert.equal(notText.code, 1);

    const signups = readDoc(root, 'datasets/signups').source.url;
    const inUse = await ctx.cli.run(['delete-asset', root, signups]);
    assert.equal(inUse.code, 1);
    assert.equal(inUse.json?.error, 'IN_USE', inUse.stdout);
    const gone = await ctx.cli.json(['delete-asset', root, url]);
    assert.equal(gone.deleted, url);
  });

  it('open serves the dashboard, wait (and comments --wait) ends quietly with nothing sent, stop ends the server', T, async () => {
    const root = copy('open');
    const opened = await ctx.cli.json(['open', root, '--json']);
    assert.equal(opened.type, TYPE);
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    const wait = await ctx.cli.run(['wait', root, '--timeout', '1']);
    assert.equal(wait.code, 2, wait.stdout);
    const commentsWait = await ctx.cli.run(['comments', root, '--wait', '--timeout', '1']);
    assert.equal(commentsWait.code, 2, commentsWait.stdout);
    const comments = await ctx.cli.run(['comments', root]);
    assert.equal(comments.code, 0);
    const stop = await ctx.cli.run(['stop']);
    assert.equal(stop.code, 0, stop.stderr);
  });
});

/**
 * A dashboard whose script, once the page is up, tries a save to the reader's own folder and one to the shared rows,
 * sets its own link (`#revenue`), and keeps what each save answered in `window.__writes`.
 */
function writeTryingDashboard(root) {
  writeDoc(root, 'dash/meta', { title: 'Saves' });
  writeDoc(root, 'files/index.html', { text: '<main><h1 id="saves">Saves</h1></main>\n<script src="app.js"></script>\n' });
  writeDoc(root, 'files/app.js', {
    text: `openartifact.use('db').then(async (db) => {
  const out = {};
  for (const [name, path] of [['own', 'data/users/me/notes'], ['team', 'data/team/notes/n1']]) {
    try { await db.write([{ op: 'set', path, data: { text: name } }]); out[name] = 'ok'; } catch (error) { out[name] = error.message; }
  }
  dash.setLink('revenue');
  window.__writes = out;
});
`,
  });
}

/** A page on an origin of its own that frames `src` (as a chat or a doc embeds a dashboard). */
async function framing(src) {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><iframe id="framed" src="${src}" style="width:900px;height:600px;border:0"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

const browserSkip = browserOff || !findChrome() ? 'no browser (E2E_BROWSER=0 or no Chrome)' : false;
const writes = `(window.__writes ? JSON.stringify(window.__writes) : null)`;
const answered = async page => (await page.evaluateAll(writes)).find(Boolean);
/** The address fragment of the frame the dashboard runs in. */
const pageHash = async page => (await page.evaluateAll(`window.__writes ? location.hash : null`)).find(hash => hash !== null);

describe(`${TYPE} in a browser`, { skip: skip() || browserSkip }, () => {
  let browser;
  before(async () => { browser = await launch(); });
  after(async () => {
    await browser?.close();
    removeTmp();
  });

  it('lets a commenter’s page save to their own folder only, and a viewer’s page nowhere', T, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/index.ts');
    const server = createTypeServer({
      secret: 'data-guests', idleMs: 0, assetsDir: path.join(typePath(TYPE), 'scripts'),
      lanAddresses: () => [], isLocal: req => !req.headers['x-test-guest'],
    });
    let guest;
    try {
      const root = path.join(tmpDir('data-guests'), 'dashboard');
      writeTryingDashboard(root);
      await server.listen();
      const opened = await server.open({ root, type: TYPE, title: 'Saves' });
      const shared = await fetch(new URL('/__open-artifact/share', opened.url), {
        method: 'POST',
        headers: { authorization: 'Bearer data-guests', 'content-type': 'application/json' },
        body: JSON.stringify({ id: opened.id, lan: true }),
      });
      assert.equal(shared.status, 200);
      const { links } = await shared.json();
      // The test listener has no LAN interface: each invitation goes to its loopback address.
      const invite = role => new URL(new URL(links[role].url).pathname, opened.url).href;
      guest = await browser.load('about:blank');
      await guest.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      const joinAs = async (role, name) => {
        await guest.cdp('Page.navigate', { url: invite(role) });
        assert.ok(await guest.waitFor("document.querySelector('input[name=name]')", 5000));
        await guest.evaluate(`document.querySelector('[name=name]').value = ${JSON.stringify(name)}; document.querySelector('form').requestSubmit()`);
        assert.ok(await guest.waitFor(writes, 15000), `${role}: the page never tried to save`);
        return JSON.parse(await answered(guest));
      };

      const commenter = await joinAs('commenter', 'Cam');
      assert.equal(commenter.own, 'ok');
      assert.match(commenter.team, /own folder/);
      const users = path.join(root, 'db', 'data', 'users');
      const folders = fs.readdirSync(users).filter(name => name.startsWith('guest-'));
      assert.equal(folders.length, 1);
      assert.deepEqual(readDoc(root, `data/users/${folders[0]}/notes`), { text: 'own' });
      assert.equal(fs.existsSync(docPath(root, 'data/team/notes/n1')), false);

      const viewer = await joinAs('viewer', 'Vic');
      assert.match(viewer.own, /owner and editors/);
      assert.match(viewer.team, /owner and editors/);
      assert.deepEqual(fs.readdirSync(users).filter(name => name.startsWith('guest-')), folders);
      assert.equal(fs.existsSync(docPath(root, 'data/team/notes/n1')), false);
    } finally {
      await guest?.close();
      await server.stop();
    }
  });

  it('offers the formats on an empty dashboard, tells the agent the pick, and hands it imported files', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-empty-type');
    const empty = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-empty-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-empty'), 'dashboard');
    let page, waiter;
    try {
      const opened = await empty.json(['open', root, '--type', TYPE, '--title', 'Imports', '--json']);
      waiter = await empty.start(['wait', root, '--timeout', '60'], { firstLine: false });
      assert.ok(await until(() => fs.existsSync(path.join(root, '_agent', 'waiting')), 10000), 'wait wrote no heartbeat');
      page = await browser.load(opened.url, { ready: "document.querySelector('.dash-empty[data-forms]')", ignore: [/\/favicon\.ico$/] });
      const labels = await page.evaluateAll("[...document.querySelectorAll('.dash-forms label')].map(label => label.textContent.trim()).join('|')");
      assert.ok(labels.includes('Dashboard|Visual analysis|Scrollyteller|Visual short'), labels.join(' / '));
      await page.evaluateAll("document.querySelector('.dash-forms input[value=scroll-story]')?.click()");
      assert.ok(
        await until(async () => (await empty.json(['context', root, '--json'])).context?.form === 'scroll-story', 10000),
        'the picked format never reached the view context',
      );
      const handed = await page.evaluateAll(`(() => {
        const input = document.querySelector('.dash-empty input[type=file]');
        if (!input) return false;
        const files = new DataTransfer();
        files.items.add(new File(['month,sales\\n2026-01,120\\n'], 'sales.csv', { type: 'text/csv' }));
        files.items.add(new File([new Uint8Array([80, 75, 3, 4])], 'Budget.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        input.files = files.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      assert.ok(handed.includes(true), 'no file input on the empty page');
      const { code } = await waiter.exited;
      const said = waiter.stdout();
      assert.equal(code, 0, said);
      assert.match(said, /Build this dashboard as a Scrollyteller from the files I imported/);
      assert.match(said, /"sales\.csv" at \/_blob\/[0-9a-f]{32} \(CSV\)/);
      assert.match(said, /"Budget\.xlsx" at \/_blob\/[0-9a-f]{32} \(Excel workbook\)/);
      assert.deepEqual(fs.readdirSync(path.join(root, '_blobs')).map(name => path.extname(name)).sort(), ['.csv', '.xlsx']);
      assert.deepEqual(page.problems, []);
    } finally {
      waiter?.child.kill();
      await page?.close();
      await empty.run(['stop']).catch(() => {});
    }
  });

  it('shows a dashboard framed through the Shell at #view-inline read only, with no bar', T, async () => {
    const overrides = {
      OPEN_ARTIFACT_HOME: tmpDir('data-daemon'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('data-shell-state'),
      OPEN_ARTIFACT_USER_TYPES: tmpDir('data-user-types'),
      OPEN_ARTIFACT_BROWSER: 'none',
    };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    let daemon, shell, host, framed;
    try {
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const { api, readDaemon } = await import('../packages/daemon/src/client.ts');
      daemon = await startDaemon({ port: 0, idleMs: 0, quiet: true, builtinTypesDir: path.dirname(typePath(TYPE)) });
      const state = await readDaemon();
      const made = await api(state, 'tools.call', {
        name: 'Artifact', arguments: { action: 'publish', type_url: `open-artifact://type/${TYPE}`, title: 'Saves' },
        caller: { harness: 'e2e', session: 'data-inline', workspace: tmpDir('data-workspace') },
      });
      assert.equal(made.error, undefined, JSON.stringify(made.error));
      const id = made.url.split('/').at(-1);
      const root = daemon.store.require(id).root;
      writeTryingDashboard(root);
      const address = `${state.url}/a/${id}#view-inline`;
      const shareButton = `Boolean(document.querySelector('header button[aria-label="Share"]'))`;
      const inline = `document.documentElement.classList.contains('dash-inline-view')`;

      // Opened on its own, the same address is the Shell with its bar and the full editor, which saves.
      shell = await browser.load(address, { ready: writes });
      assert.ok((await shell.evaluateAll(shareButton)).includes(true));
      assert.deepEqual((await shell.evaluateAll(inline)).filter(Boolean), []);
      assert.deepEqual(JSON.parse(await answered(shell)), { own: 'ok', team: 'ok' });
      assert.equal(await pageHash(shell), '#revenue');
      await shell.close();
      shell = undefined;
      fs.rmSync(path.join(root, 'db', 'data'), { recursive: true, force: true });

      // Framed by another page: no bar, the embedded view, every save refused, and the fragment kept on the Shell and on
      // the page, whose own link leaves it as it was.
      host = await framing(address);
      framed = await browser.load(host.url, { ready: writes });
      assert.ok((await framed.evaluateAll(inline)).includes(true));
      assert.deepEqual((await framed.evaluateAll(shareButton)).filter(Boolean), []);
      assert.deepEqual(JSON.parse(await answered(framed)), { own: 'This embedded dashboard is view-only.', team: 'This embedded dashboard is view-only.' });
      assert.equal(fs.existsSync(path.join(root, 'db', 'data')), false);
      assert.ok((await framed.evaluateAll(`location.pathname === ${JSON.stringify(`/a/${id}`)} && location.hash`)).includes('#view-inline'));
      assert.equal(await pageHash(framed), '#view-inline');
      assert.deepEqual(framed.problems, []);
    } finally {
      await framed?.close();
      await host?.close();
      await shell?.close();
      await daemon?.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('gives a page the token names of the dashboards on claude.ai, as its own tokens in light, dark and under a look', T, async () => {
    // A page brought over from claude.ai writes --cds-* and --font-anthropic-* (its spacing, sizes, chart and popover
    // colors, fonts). Before the aliases, most of them were set nowhere here and silently fell back to nothing.
    const { DASH_CLAUDE_TOKEN_ALIASES } = await import('../packages/data-core/src/look.ts');
    const { dir } = install(typePath(TYPE), 'data-claude-type');
    const serving = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-claude-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-claude'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [serving.script, root], { env: serving.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      writeDoc(root, 'dash/look', { light: { ground: '#f3f5f9', card: '#ffffff', text: '#0d1b33', muted: '#5a6780', border: '#d6dce8' }, corners: '4px' });
      const opened = await serving.json(['open', root, '--json']);
      page = await browser.load(opened.url, { ready: "document.querySelector('#dash-root [data-source]')", timeout: 60000, settle: 1000, ignore: [/\/favicon\.ico$/] });
      // Each probe draws with the claude.ai names; its twin with the tokens they stand for.
      const read = mode => `(() => {
        document.documentElement.setAttribute('data-mode', ${JSON.stringify(mode)});
        const place = document.querySelector('#dash-root [data-source]').parentElement;
        const draw = (pad, radius, serif, critical) => {
          const probe = document.createElement('div');
          probe.style.cssText = 'padding:var(' + pad + ');border-radius:var(' + radius + ');font-family:var(' + serif + ');color:var(' + critical + ');background:var(' + (pad.startsWith('--cds') ? '--cds-surface-popover' : '--dash-surface-popover') + ')';
          place.append(probe);
          const style = getComputedStyle(probe);
          return { probe, style, drawn: [style.paddingTop, style.borderTopLeftRadius, style.fontFamily, style.color, style.backgroundColor] };
        };
        const claude = draw('--cds-pad-lg', '--cds-radius', '--font-anthropic-serif', '--cds-chart-status-critical');
        const own = draw('--dash-pad-lg', '--dash-radius', '--font-serif', '--dash-chart-critical');
        const value = name => claude.style.getPropertyValue(name).trim();
        const aliases = ${JSON.stringify(DASH_CLAUDE_TOKEN_ALIASES)};
        const shown = {
          differ: Object.entries(aliases).filter(([alias, token]) => !value(token) || value(alias) !== value(token)).map(([alias, token]) => alias + '=' + value(alias) + ' ' + token + '=' + value(token)),
          claude: claude.drawn, own: own.drawn,
        };
        claude.probe.remove();
        own.probe.remove();
        return shown;
      })()`;
      const light = await page.evaluate(read('light'));
      assert.deepEqual(light.differ, [], 'a claude.ai name is not its token in light');
      assert.deepEqual(light.claude, light.own, 'the claude.ai names draw unlike the tokens in light');
      const [padding, radius, font, , popover] = light.claude;
      assert.equal(padding, '16px');
      assert.equal(radius, '4px', 'the look’s corners did not reach --cds-radius');
      assert.match(font, /Georgia/);
      assert.equal(popover, 'rgb(255, 255, 255)', 'the look’s card did not reach --cds-surface-popover');
      const dark = await page.evaluate(read('dark'));
      assert.deepEqual(dark.differ, [], 'a claude.ai name is not its token in dark');
      assert.deepEqual(dark.claude, dark.own, 'the claude.ai names draw unlike the tokens in dark');
      assert.equal(dark.claude[4], 'rgb(32, 32, 31)', 'the popover color did not follow the dark theme');
    } finally {
      await page?.close();
      await serving.run(['stop']).catch(() => {});
    }
  });

  it('counts the sources on their button, links a failed one from its notice, opens a linked one in its host, and downloads rows a spreadsheet reads as UTF-8', T, async () => {
    // The fixture's sales connector runs: orders loads, and with the Support tab shown tickets loads and broken's tool
    // fails, so the dashboard's notice names one source. The orders source gets a link the page keeps (https, a host).
    const { dir } = install(typePath(TYPE), 'data-sources-type');
    const home = tmpDir('data-sources-home');
    const downloads = path.join(home, 'Downloads');
    fs.mkdirSync(downloads, { recursive: true });
    const sourcing = cli(dir, {
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-sources-state'), 'state'),
      HOME: home,
      OPEN_ARTIFACT_USER: 'E2E',
      OPEN_ARTIFACT_CONNECTORS: writeTestConnectors(path.join(home, 'connectors')),
    });
    const root = path.join(tmpDir('data-sources'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [sourcing.script, root], { env: sourcing.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      writeDoc(root, 'datasets/orders', { ...readDoc(root, 'datasets/orders'), link: 'https://docs.example.com/orders' });
      const opened = await sourcing.json(['open', root, '--json']);
      page = await browser.load(opened.url, { ready: "document.querySelector('#tab-support') && document.querySelector('[data-dash-sources] button')", timeout: 60000, settle: 1000, ignore: [/\/favicon\.ico$/] });
      // The broken source sits on the Support tab; shown, it loads and fails.
      await page.evaluate(`document.querySelector('#tab-support').click()`);
      assert.ok(await page.waitFor(`document.querySelector('[data-dash-sources-notice]')`, 30000), 'the failed source raised no notice');

      // The Sources button carries the count, as its badge and in its name.
      const button = `document.querySelector('[data-dash-sources] button')`;
      // Eight: the fixture's six stored sources and the page's two calculations, as many as the Sources list shows.
      assert.equal(await page.evaluate(`document.querySelector('[data-dash-sources-count]')?.textContent`), '8');
      assert.equal(await page.evaluate(`${button}.getAttribute('aria-label')`), 'Sources (8)');

      // A source with a link opens it in its host, in a new tab.
      await page.evaluate(`${button}.click()`);
      const row = `[...document.querySelectorAll('[data-source-row]')].find(b => b.getAttribute('aria-label').startsWith('Orders by month'))`;
      assert.ok(await page.waitFor(row, 10000), 'the Sources list shows no orders');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-source-row]').length`), 8, 'the badge does not count what the Sources list shows');
      await page.evaluate(`${row}.click()`);
      assert.ok(await page.waitFor(`document.querySelector('a[data-source-link]')`, 10000), 'the linked source has no link button');
      const opens = await page.evaluate(`(() => { const a = document.querySelector('a[data-source-link]'); return { href: a.href, target: a.target, rel: a.rel, name: a.getAttribute('aria-label') }; })()`);
      assert.deepEqual(opens, {
        href: 'https://docs.example.com/orders',
        target: '_blank',
        rel: 'noopener noreferrer',
        name: 'Open Orders by month in docs.example.com (opens in a new tab)',
      });

      // Its rows download as CSV starting with a byte order mark, so spreadsheets read them as UTF-8.
      const download = `document.querySelector('[aria-label="Download Orders by month"]')`;
      // The Result section starts folded; opened, its rows offer Download.
      const result = `[...document.querySelectorAll('.dash-side h3 > button[aria-expanded]')].find(b => b.textContent.trim() === 'Result')`;
      assert.ok(await page.waitFor(result, 30000), 'the orders source shows no Result');
      await page.evaluate(`(() => { const b = ${result}; if (b.getAttribute('aria-expanded') !== 'true') b.click(); })()`);
      assert.ok(await page.waitFor(download, 30000), 'the orders result has no Download');
      await page.evaluate(`${download}.click()`);
      const saved = () => fs.readdirSync(downloads).find(name => /^orders.*\.csv$/.test(name));
      assert.ok(await until(saved, 15000), `no CSV was saved: ${fs.readdirSync(downloads)}`);
      const bytes = fs.readFileSync(path.join(downloads, saved()));
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the CSV has no byte order mark');
      assert.match(bytes.subarray(3).toString('utf8').split('\n')[0], /\bregion\b.*\brevenue\b/, 'the CSV does not start with the orders’ columns');

      // The notice names how many sources didn’t load; the count is a link to them, here to the one source in detail.
      const notice = `document.querySelector('[data-dash-sources-notice]')`;
      const link = `[...${notice}.querySelectorAll('button')].find(b => b.textContent === '1 source')`;
      assert.ok(await page.waitFor(link, 30000), `the count in the notice is not a link: ${await page.evaluate(`${notice}?.innerText`)}`);
      assert.match(await page.evaluate(`${notice}.innerText`), /1 source didn’t load\./);
      await page.evaluate(`${link}.click()`);
      assert.ok(await page.waitFor(`document.querySelector('[aria-label="Broken source"]')`, 10000), 'the count did not open the failed source');
    } finally {
      await page?.close();
      await sourcing.run(['stop']).catch(() => {});
    }
  });

  it('prints the dashboard itself, not a blank sheet, beside nothing of the editor', T, async () => {
    // Issue #24: #dash-root carries the print path's mark too, and the rule hiding every unmarked child of a marked
    // element hid the dashboard's own content. The PDF button and the browser's Print both mark the path; `beforeprint`
    // does it here, under print media, as the dialog would lay the page out.
    const { dir } = install(typePath(TYPE), 'data-print-type');
    const printing = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-print-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-print'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [printing.script, root], { env: printing.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      const opened = await printing.json(['open', root, '--json']);
      page = await browser.load(opened.url, { ready: "document.querySelector('#dash-root [data-source]')", timeout: 60000, settle: 1500, ignore: [/\/favicon\.ico$/] });
      await page.cdp('Emulation.setEmulatedMedia', { media: 'print' });
      const shown = `(() => {
        const root = document.getElementById('dash-root');
        const note = document.querySelector('[data-dash-print-note]');
        const beside = [...document.body.querySelectorAll('*')].filter(e => !e.contains(root) && !root.contains(e) && !e.closest('[data-dash-print-note]') && e.getClientRects().length > 0);
        return { height: Math.round(root.getBoundingClientRect().height), text: root.innerText.trim(), note: note?.getClientRects().length > 0 ? note.innerText.trim() : '', beside: beside.length };
      })()`;
      const before = await page.evaluate(shown);
      assert.match(before.text, /Sales and signups/, 'the fixture drew no title');
      await page.evaluate("window.dispatchEvent(new Event('beforeprint'))");
      assert.ok(await page.evaluate("document.getElementById('dash-root').hasAttribute('data-dash-print-path')"), 'beforeprint marked no path');
      const printed = await page.evaluate(shown);
      assert.match(printed.text, /Sales and signups/, `the printed dashboard is blank: ${JSON.stringify(printed)}`);
      assert.equal(printed.height, before.height, 'the dashboard printed at another length');
      assert.match(printed.note, /^Data as of /, 'the data note did not print under the dashboard');
      assert.equal(printed.beside, 0, 'the editor around the dashboard printed');
      await page.evaluate("window.dispatchEvent(new Event('afterprint'))");
      assert.equal(await page.evaluate("document.querySelectorAll('[data-dash-print-path]').length"), 0, 'afterprint left the path marked');
    } finally {
      await page?.close();
      await printing.run(['stop']).catch(() => {});
    }
  });

  it('exports the dashboard as a PDF file made in the page, and keeps Print as its own entry', { timeout: 150000 }, async () => {
    // Export → PDF used to open the print dialog. It now saves a file: a copy of the dashboard laid out as it prints,
    // one paper wide, each page a picture under its selectable words. Print… stays, for the dialog.
    const { dir } = install(typePath(TYPE), 'data-pdf-type');
    // The server saves exports into the user's Downloads folder: a home of the test's own.
    const home = tmpDir('data-pdf-home');
    const downloads = path.join(home, 'Downloads');
    fs.mkdirSync(downloads, { recursive: true });
    const exporting = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-pdf-state'), 'state'), HOME: home, OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-pdf'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [exporting.script, root], { env: exporting.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      const origin = new URL((await exporting.json(['open', root, '--json'])).url).origin;
      const opened = await exporting.json(['open', root, '--shell', origin, '--json']);
      // The server's own root (plain text, no CSP) stands in for the Shell's page, on the same origin.
      page = await browser.load(origin + '/', { ready: 'document.readyState === "complete"', ignore: [/\/favicon\.ico$/] });
      await page.evaluate(`(() => {
        window.__messages = [];
        addEventListener('message', e => window.__messages.push(e.data));
        document.body.innerHTML = '';
        const f = document.createElement('iframe');
        f.src = ${JSON.stringify(opened.url)};
        f.style.cssText = 'border:0;width:1200px;height:800px';
        document.body.append(f);
      })()`);
      const formats = `(window.__messages.filter(m => m?.openArtifact === 'chrome_report' && m.report?.formats).at(-1)?.report.formats ?? [])`;
      assert.ok(
        await page.waitFor(`${formats}.some(f => f.format === 'pdf' && !f.disabled)`, 60000),
        `the page never offered its PDF: ${JSON.stringify(await page.evaluate(formats))}`,
      );
      const offered = await page.evaluate(formats);
      assert.deepEqual(offered.map(f => f.format), ['pdf', 'print', 'html', 'json']);
      assert.equal(offered.find(f => f.format === 'pdf').more, undefined, 'the PDF row still says it opens something first');
      assert.equal(offered.find(f => f.format === 'print').more, true, 'Print… does not say it opens a dialog');

      const frame = `document.querySelector('iframe').contentDocument`;
      // The Signups tab draws a bar chart from the uploaded file. A print rule of the page's own sends the note under
      // it to a second sheet: only a copy laid out as it prints has two pages.
      await page.evaluate(`(() => {
        const doc = ${frame};
        doc.getElementById('tab-signups').click();
        const style = doc.createElement('style');
        style.textContent = '@media print { #signups .fx-note { break-before: page } } @media screen { #signups .fx-note { break-before: auto } }';
        doc.head.append(style);
        // A box that scrolls on screen (a long table in a short card): paper doesn't scroll, so the copy shows all of it.
        const scroller = doc.createElement('div');
        scroller.id = 'e2e-scroller';
        scroller.style.cssText = 'max-height:80px;overflow-y:auto';
        scroller.innerHTML = Array.from({ length: 60 }, (_, row) => '<div style="height:20px;line-height:20px">Scrolled row ' + (row + 1) + '</div>').join('');
        doc.querySelector('#signups .fx-note').after(scroller);
      })()`);
      assert.ok(await page.waitFor(`${frame}.querySelectorAll('#signups-chart svg rect').length > 0`, 30000), 'the signups chart drew no bars');
      const drawn = await page.evaluate(`${frame}.getElementById('dash-root').innerText`);
      assert.match(drawn, /Sales and signups/, 'the fixture drew no title');
      await page.evaluate(`document.querySelector('iframe').contentWindow.postMessage({ openArtifact: 'chrome_cmd', cmd: 'export_format', request: 'e2eDashboardPdf000001', format: 'pdf' }, location.origin)`);
      const answers = `window.__messages.filter(m => m?.openArtifact === 'chrome_export' && m.request === 'e2eDashboardPdf000001')`;
      assert.ok(await page.waitFor(`${answers}.some(m => m.state === 'done' || m.state === 'failed')`, 90000), 'the PDF export never finished');
      assert.deepEqual((await page.evaluate(answers)).map(m => m.state), ['started', 'done'], JSON.stringify(await page.evaluate(answers)));
      const saved = path.join(downloads, 'Sales and signups.pdf');
      assert.ok(await until(() => fs.existsSync(saved) && fs.statSync(saved).size > 0, 30000), `no PDF was saved: ${fs.readdirSync(downloads)}`);
      const file = { path: saved, bytes: fs.readFileSync(saved) };
      const pdf = file.bytes.toString('latin1');
      assert.ok(pdf.startsWith('%PDF-'), 'the download is not a PDF');
      // Headless Chrome speaks en-US: US Letter. The dashboard shows wider than the paper here, so the sheet lies on
      // its side and the copy keeps the dashboard's width (the chart's bars were sized for it by script).
      const shownWidth = await page.evaluate(`Math.ceil(${frame}.getElementById('dash-root').getBoundingClientRect().width)`);
      assert.ok(shownWidth > 980 && shownWidth <= 1200, `the fixture shows at an unexpected width: ${shownWidth}`);
      assert.match(pdf, /\/MediaBox ?\[ ?0 0 792 612 ?\]/, 'the pages are not Letter paper on its side');
      assert.ok(pdf.includes('/DCTDecode'), 'the pages carry no picture');
      // Two sheets from the page's own print rule, and a third for the rows the box scrolled out of sight on screen
      // (1,200 px of them: more than the second sheet has left).
      assert.match(pdf, /\/Type \/Pages[^>]*\/Count 3\b/, 'the print rule did not start a second sheet, or the scrolling box was not printed whole');
      assert.equal(await page.evaluate(`${frame}.getElementById('e2e-scroller').clientHeight`), 80, 'the export changed the scrolling box on the page');

      // The first page's picture shows the dashboard (ink on a light page), not a blank or dark sheet.
      const at = file.bytes.indexOf('/DCTDecode');
      const length = Number(/\/Length (\d+)/.exec(file.bytes.subarray(at, at + 200).toString('latin1'))?.[1]);
      const start = file.bytes.indexOf('stream\n', at) + 'stream\n'.length;
      const picture = `data:image/jpeg;base64,${file.bytes.subarray(start, start + length).toString('base64')}`;
      const seenInk = await page.evaluate(`(async () => {
        const image = new Image();
        image.src = ${JSON.stringify(picture)};
        await image.decode();
        const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let dark = 0, light = 0;
        for (let i = 0; i < data.length; i += 4) {
          const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
          if (luma < 96) dark += 1;
          else if (luma > 224) light += 1;
        }
        return { width: canvas.width, height: canvas.height, dark: dark / (data.length / 4), light: light / (data.length / 4) };
      })()`);
      assert.equal(seenInk.width, shownWidth * 2, `the page picture is not the dashboard's width at two pixels a CSS pixel: ${JSON.stringify(seenInk)}`);
      assert.ok(Math.abs(seenInk.width / seenInk.height - 792 / 612) < 0.01, `the page picture is not the sheet's shape: ${JSON.stringify(seenInk)}`);
      assert.ok(seenInk.dark > 0.002, `the PDF page is blank: ${JSON.stringify(seenInk)}`);
      assert.ok(seenInk.light > 0.5, `the PDF page is not in the light look: ${JSON.stringify(seenInk)}`);

      // The live page is as it was: no frame left behind, nothing marked for print.
      assert.equal(await page.evaluate(`${frame}.querySelectorAll('[data-dash-print-copy], [data-dash-print-path]').length`), 0, 'the export left its frame or its print marks behind');
      assert.equal(await page.evaluate(`${frame}.getElementById('dash-root').innerText`), drawn, 'the export changed the page');
    } finally {
      await page?.close();
      await exporting.run(['stop']).catch(() => {});
    }
  });

  it('restores an earlier version from its row in History after asking, and offers no Restore on the current one', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-restore-type');
    // The fixture's sales sources call their connector, so the test one runs.
    const home = tmpDir('data-restore-home');
    const restoring = cli(dir, {
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-restore-state'), 'state'),
      HOME: home,
      OPEN_ARTIFACT_USER: 'E2E',
      OPEN_ARTIFACT_CONNECTORS: writeTestConnectors(path.join(home, 'connectors')),
    });
    const root = path.join(tmpDir('data-restore'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [restoring.script, root], { env: restoring.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      // Listing records the load's own edits as a version first, so the rename is a version of its own.
      await restoring.json(['history', root, '--json']);
      await restoring.json(['write-db', root, JSON.stringify([{ op: 'update', path: 'dash/meta', data: { title: 'Renamed' } }])]);
      const before = (await restoring.json(['history', root, '--json'])).versions;
      assert.ok(before.length >= 2, `the dashboard has ${before.length} version(s)`);
      const [latest, earlier] = before;
      const opened = await restoring.json(['open', root, '--json']);
      page = await browser.load(opened.url, { ready: "document.querySelector('[data-dash-sources] button')", ignore: [/\/favicon\.ico$/] });
      const one = async expression => (await page.evaluateAll(expression)).find(value => value !== null && value !== undefined);

      await page.evaluateAll(`document.querySelector('button[aria-label="History"]')?.click()`);
      assert.ok(await page.waitFor(`document.querySelectorAll('li > [data-version]').length === ${before.length}`, 15000), 'History listed no versions');
      const restoreIn = n => `document.querySelector('[data-version="${n}"]')?.closest('li')?.querySelector('[data-version-restore]')`;
      assert.equal(await one(`document.querySelector('[data-version="${latest.n}"]') ? Boolean(${restoreIn(latest.n)}) : null`), false, 'the current version offers Restore');
      assert.match(await one(`${restoreIn(earlier.n)}?.getAttribute('aria-label') ?? null`), /^Restore the version from /);

      // On a precise pointer the row's Restore shows once the row is hovered, and the mouse can press it.
      const center = selector => `(() => { const r = ${selector}?.getBoundingClientRect(); return r ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`;
      const hovers = await one(`matchMedia('(hover: hover) and (pointer: fine)').matches`);
      if (hovers) {
        assert.equal(await one(`${restoreIn(earlier.n)} ? getComputedStyle(${restoreIn(earlier.n)}).opacity : null`), '0', 'Restore shows before the row is hovered');
        const [x, y] = await one(center(`document.querySelector('[data-version="${earlier.n}"]')`));
        await page.hover(x, y);
        assert.ok(await page.waitFor(`getComputedStyle(${restoreIn(earlier.n)}).opacity === '1'`, 5000), 'hovering the row did not show its Restore');
        const [bx, by] = await one(center(restoreIn(earlier.n)));
        await page.click(bx, by);
      } else await page.evaluateAll(`${restoreIn(earlier.n)}?.click()`);

      const dialog = `document.querySelector('[role="dialog"]')`;
      assert.ok(await page.waitFor(`${dialog}?.textContent.includes('Restore this earlier version?')`, 5000), 'Restore asked nothing first');
      assert.match(await one(`${dialog}?.textContent ?? null`), /\. Everyone will see it\./);
      // The focus moves in once the dialog is up.
      const focused = `document.activeElement?.closest('[role="dialog"]') ? document.activeElement.textContent.trim() : null`;
      assert.ok(await page.waitFor(`(${focused}) !== null`, 5000), 'the question took no focus');
      assert.equal(await one(focused), 'Cancel', 'the question does not start on Cancel');

      // Cancel puts focus back on the row's Restore and restores nothing.
      await page.evaluateAll(`[...(${dialog}?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'Cancel')?.click()`);
      assert.ok(await page.waitFor(`!${dialog} && document.activeElement === ${restoreIn(earlier.n)}`, 5000), 'Cancel did not hand focus back to Restore');
      assert.equal((await restoring.json(['history', root, '--json'])).versions.length, before.length);

      await page.evaluateAll(`${restoreIn(earlier.n)}?.click()`);
      assert.ok(await page.waitFor(`${dialog}?.textContent.includes('Restore this earlier version?')`, 5000));
      await page.evaluateAll(`[...(${dialog}?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'Restore')?.click()`);
      assert.ok(await page.waitFor(`document.body.innerText.includes('Restored.')`, 15000), 'no "Restored." toast');
      assert.ok(await page.waitFor(`document.querySelectorAll('li > [data-version]').length === ${before.length + 1}`, 15000), 'the list shows no new current version');
      assert.equal(await one(`document.activeElement?.getAttribute('data-version') ?? null`), String(earlier.n), 'focus did not go to the restored row');
      assert.equal(await one(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'All versions') ? 'detail' : 'list'`), 'list', 'restoring from the list left the list');
      const after = (await restoring.json(['history', root, '--json'])).versions;
      assert.equal(after.length, before.length + 1);
      assert.equal(await one(`Boolean(${restoreIn(after[0].n)})`), false, 'the new current version offers Restore');
      assert.deepEqual(page.problems, []);
    } finally {
      await page?.close();
      await restoring.run(['stop']).catch(() => {});
    }
  });

  it('shows the card of a page link that leads away, reads out Corners held at its bound, and offers the pencil', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-links-type');
    // The fixture's sales sources call their connector, so the test one runs.
    const home = tmpDir('data-links-home');
    const linking = cli(dir, {
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-links-state'), 'state'),
      HOME: home,
      OPEN_ARTIFACT_USER: 'E2E',
      OPEN_ARTIFACT_CONNECTORS: writeTestConnectors(path.join(home, 'connectors')),
    });
    const root = path.join(tmpDir('data-links'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [linking.script, root], { env: linking.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      const index = readDoc(root, 'files/index.html');
      writeDoc(root, 'files/index.html', { ...index, text: `<p id="away">Read <a href="https://www.example.com/guide/start">the guide</a> first.</p>\n${index.text}` });
      const opened = await linking.json(['open', root, '--json']);
      page = await browser.load(opened.url, { ready: "document.querySelector('#away a') && document.querySelector('[data-dash-sources] button')", ignore: [/\/favicon\.ico$/] });

      // Resting the pointer on the link shows its card: the host first, the path after it, and Copy link.
      const [x, y] = await page.evaluate(`(() => { const r = document.querySelector('#away a').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      await page.hover(x, y);
      const card = `document.querySelector('[data-link-details]')`;
      assert.ok(await page.waitFor(card, 5000), 'resting on the link showed no card');
      assert.equal(await page.evaluate(`${card}.getAttribute('aria-label')`), 'Link details');
      assert.equal(await page.evaluate(`${card}.querySelector('a[target="_blank"]')?.getAttribute('aria-label') ?? null`), 'https://www.example.com/guide/start');
      assert.match(await page.evaluate(`${card}.textContent`), /^example\.com\/guide\/start/);
      assert.equal(await page.evaluate(`Boolean(${card}.querySelector('button[aria-label="Copy link"]'))`), true, 'the card has no Copy link');
      // Off the link and the card, it goes.
      await page.hover(x, y + 200);
      assert.ok(await page.waitFor(`!${card}`, 5000), 'the card stayed after the pointer left');

      // The owner of a dashboard with a page may edit it.
      assert.ok(await page.waitFor(`document.querySelector('[data-dash-pencil]')`, 10000), 'a dashboard with a page offers no pencil');

      // Corners typed past its top is held there, and that is read out.
      await page.evaluate(`document.querySelector('button[aria-label="Design"]').click()`);
      const field = `document.querySelector('input[aria-label="Corners"]')`;
      assert.ok(await page.waitFor(field, 10000), 'the Design panel has no Corners field');
      await page.evaluate(`(() => { const input = ${field}; input.focus(); input.select(); })()`);
      await page.type('40');
      await page.press('Enter');
      const said = `[...document.querySelectorAll('[role="status"][aria-live]')].map(region => region.textContent).join(' ')`;
      assert.ok(await page.waitFor(`(${said}).includes('Changed to 32. Corners can’t go higher.')`, 5000), `nothing read out the bound: ${await page.evaluate(said)}`);
      assert.equal(await page.evaluate(`${field}.value`), '32');
      assert.deepEqual(page.problems, []);
    } finally {
      await page?.close();
      await linking.run(['stop']).catch(() => {});
    }
  });

  it('offers no pencil on a dashboard whose files have no page', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-pageless-type');
    const pageless = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-pageless-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-pageless'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [pageless.script, root], { env: pageless.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      fs.rmSync(docPath(root, 'files/index.html'));
      const opened = await pageless.json(['open', root, '--json']);
      page = await browser.load(opened.url, { ready: "document.querySelector('.dash-empty')", settle: 1000, ignore: [/\/favicon\.ico$/] });
      assert.equal(await page.evaluate(`Boolean(document.querySelector('[data-dash-pencil]'))`), false, 'a dashboard with no page offers the pencil');
    } finally {
      await page?.close();
      await pageless.run(['stop']).catch(() => {});
    }
  });
});

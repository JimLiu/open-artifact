// End-to-end tests of the data type's command line: the fixture dashboard (fixtures/data) is written through write-db
// and passes check, also with the token names of claude.ai's dashboards; a broken copy of each kind fails it with the
// finding the page would show; write-db refuses what the page would drop and writes nothing; history leaves out
// dash/settings; upload, read-db --text and delete-asset; open, wait and stop. In a browser: what a guest's page may
// save (a commenter only their own folder), the read-only embedded view of a dashboard another page frames through the
// Shell, the empty dashboard's format picker and file import, and claude.ai's token names drawing as the dashboard's
// own tokens in light, dark and under a look.
// The sources: their count on the Sources button, a linked source's Open in its host, the CSV download's byte order
// mark and the failure notice's link to what didn’t load. Restoring an earlier version from History. The card of a
// page link that leads away, the Corners field read out at its bound, and the pencil only with a page to edit. Sharing
// a connector's access from Sources, so a viewer's page loads the query.
// The shared draft: Publish, Discard draft and its Restore in History, a viewer's See draft, and hand edits kept in
// the draft as they are made, with Undo and Redo on their own.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { cli, run } from './lib/cli.mjs';
import { clickOn } from './lib/editor.mjs';
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

  it('shows the shared draft with Publish, brings a discarded one back from History, and offers a viewer See draft', T, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/index.ts');
    const server = createTypeServer({
      secret: 'data-drafts', idleMs: 0, assetsDir: path.join(typePath(TYPE), 'scripts'),
      lanAddresses: () => [], isLocal: req => !req.headers['x-test-guest'],
    });
    let page, guest;
    try {
      const root = path.join(tmpDir('data-drafts'), 'dashboard');
      const titled = title => ({ text: `<main><h1 id="title">${title}</h1></main>\n` });
      writeDoc(root, 'dash/meta', { title: 'Drafts' });
      writeDoc(root, 'files/index.html', titled('Live'));
      // Someone left a change in the shared draft.
      writeDoc(root, 'drafts/shared', { v: 1, kind: 'edit', by: 'someone', at: Date.now(), base: '' });
      writeDoc(root, 'drafts/shared/files/index.html', titled('Draft'));
      await server.listen();
      const opened = await server.open({ root, type: TYPE, title: 'Drafts' });

      const shown = `document.querySelector('h1#title')?.textContent ?? null`;
      const button = label => `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(label)})`;
      const has = async (p, expression) => (await p.evaluateAll(`Boolean(${expression})`)).some(Boolean);
      const title = async p => (await p.evaluateAll(shown)).find(value => value !== null);
      const showing = (p, text, ms = 15000) => p.waitFor(`(${shown}) === ${JSON.stringify(text)}`, ms);

      // A viewer sees the published page, and See draft shows the draft.
      const shared = await fetch(new URL('/__open-artifact/share', opened.url), {
        method: 'POST',
        headers: { authorization: 'Bearer data-drafts', 'content-type': 'application/json' },
        body: JSON.stringify({ id: opened.id, lan: true }),
      });
      assert.equal(shared.status, 200);
      const { links } = await shared.json();
      guest = await browser.load('about:blank');
      await guest.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      await guest.cdp('Page.navigate', { url: new URL(new URL(links.viewer.url).pathname, opened.url).href });
      assert.ok(await guest.waitFor("document.querySelector('input[name=name]')", 5000));
      await guest.evaluate(`document.querySelector('[name=name]').value = 'Vic'; document.querySelector('form').requestSubmit()`);
      assert.ok(await guest.waitFor(button('See draft'), 20000), 'a viewer is offered no See draft');
      assert.equal(await title(guest), 'Live');
      assert.equal(await has(guest, button('Publish')), false, 'a viewer is offered Publish');
      await guest.evaluateAll(`${button('See draft')}?.click()`);
      assert.ok(await showing(guest, 'Draft'), 'See draft did not show the draft');
      assert.ok(await guest.waitFor(button('See published'), 5000), 'the draft offers no way back');

      // The owner sees the draft, with Publish.
      page = await browser.load(opened.url, { ready: button('Publish'), ignore: [/\/favicon\.ico$/] });
      assert.ok(await showing(page, 'Draft'), 'the owner is not shown the draft');

      // Discard draft asks, keeps the page, and leaves the draft in History.
      await page.evaluateAll(`${button('Draft options')}?.click()`);
      const item = label => `[...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.trim() === ${JSON.stringify(label)})`;
      assert.ok(await page.waitFor(item('Discard draft'), 5000), 'the draft options offer no Discard draft');
      await page.evaluateAll(`${item('Discard draft')}?.click()`);
      const dialog = `document.querySelector('[role="dialog"]')`;
      assert.ok(await page.waitFor(`${dialog}?.textContent.includes('Discard this draft?')`, 5000), 'Discard draft asked nothing');
      assert.match((await page.evaluateAll(`${dialog}?.textContent ?? null`)).find(Boolean), /The draft can be restored from History\./);
      await page.evaluateAll(`[...(${dialog}?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'Discard')?.click()`);
      assert.ok(await showing(page, 'Live'), 'the page did not go back to the published one');
      assert.ok(await page.waitFor(`document.body.innerText.includes('Draft discarded.')`, 10000), 'no "Draft discarded." toast');
      assert.equal(readDoc(root, 'files/index.html').text, titled('Live').text);
      assert.equal(fs.existsSync(docPath(root, 'drafts/shared/files/index.html')), false, 'the discarded change is still in the draft');
      assert.ok(await page.waitFor(button('Published'), 10000), 'no Published menu once the draft is gone');

      // History lists the discarded draft; its Restore puts the change back in the draft.
      await page.evaluateAll(`${button('History')}?.click()`);
      const restore = `document.querySelector('[data-draft] button[aria-label^="Restore the draft from "]')`;
      assert.ok(await page.waitFor(restore, 15000), 'History lists no discarded draft');
      assert.match((await page.evaluateAll(`document.querySelector('[data-draft]')?.textContent ?? null`)).find(Boolean), /discarded a draft/);
      await page.evaluateAll(`${restore}?.click()`);
      assert.ok(await page.waitFor(button('Publish'), 15000), 'restoring brought no draft back');
      assert.ok(await showing(page, 'Draft'), 'the restored draft is not shown');
      // The open draft's row opens its own page: what publishing it would change, against the published page.
      const draftRow = `document.querySelector('[data-open-draft] button[data-row-main]')`;
      assert.ok(await page.waitFor(draftRow, 10000), 'History lists no open draft');
      await page.evaluateAll(`${draftRow}?.click()`);
      assert.ok(await page.waitFor(`${button('All versions')} && [...document.querySelectorAll('h3')].some(h => h.textContent.includes('Draft'))`, 10000), 'the open draft has no page of its own');
      const draftPage = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'All versions')?.closest('div')?.parentElement?.innerText ?? ''`;
      assert.ok(await has(page, `(${draftPage}).includes('Edited the page') && (${draftPage}).includes('index.html')`), 'the draft’s page shows no change');
      await page.evaluateAll(`${button('All versions')}?.click()`);
      assert.ok(await page.waitFor(draftRow, 5000), 'All versions did not go back to the list');
      await page.evaluateAll(`${button('History')}?.click()`);

      // Publish writes the draft into the dashboard for everyone.
      await page.evaluateAll(`${button('Publish')}?.click()`);
      assert.ok(await until(() => readDoc(root, 'files/index.html').text === titled('Draft').text, 15000), 'Publish wrote nothing');
      assert.ok(await page.waitFor(button('Published'), 15000), 'no Published menu after publishing');
      assert.equal(fs.existsSync(docPath(root, 'drafts/shared/files/index.html')), false, 'the published change is still in the draft');
      assert.ok(await until(async () => !(await has(guest, button('See draft'))) && !(await has(guest, button('See published'))), 15000), 'the viewer still has a draft to see');
      assert.ok(await showing(guest, 'Draft'), 'the viewer does not see what was published');

      // Auto-publish is a switch in the menu, which stays open as it is turned off.
      await page.evaluateAll(`${button('Published')}?.click()`);
      const auto = `[...document.querySelectorAll('[role="menuitemcheckbox"]')].find(i => i.textContent.trim() === 'Auto-publish')`;
      assert.ok(await page.waitFor(`${auto}?.getAttribute('aria-checked') === 'true'`, 5000), 'the menu offers no Auto-publish that is on');
      await page.evaluateAll(`${auto}?.click()`);
      assert.ok(await until(() => fs.existsSync(docPath(root, 'dash/settings')) && readDoc(root, 'dash/settings').autoPublish === false, 10000), 'turning Auto-publish off wrote nothing');
      assert.ok(await page.waitFor(`${auto}?.getAttribute('aria-checked') === 'false'`, 5000), 'the menu closed, or the switch did not turn off');
      await page.press('Escape');
      assert.deepEqual(page.problems, []);
    } finally {
      await guest?.close();
      await page?.close();
      await server.stop();
    }
  });

  it('keeps hand edits in the shared draft as they are made, with Undo and Redo on their own, and publishes them once the pencil is put down', T, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/index.ts');
    const server = createTypeServer({ secret: 'data-joint', idleMs: 0, assetsDir: path.join(typePath(TYPE), 'scripts'), lanAddresses: () => [] });
    let page;
    try {
      const root = path.join(tmpDir('data-joint'), 'dashboard');
      writeDoc(root, 'dash/meta', { title: 'Joint' });
      writeDoc(root, 'files/index.html', { text: '<meta name="dash-one-writer">\n<main><h1 id="title">Live</h1><p id="body">Some words.</p></main>\n' });
      await server.listen();
      const opened = await server.open({ root, type: TYPE, title: 'Joint' });
      page = await browser.load(opened.url, { ready: `document.querySelector('[data-dash-pencil]') && document.querySelector('h1#title')`, ignore: [/\/favicon\.ico$/] });
      const one = async expression => (await page.evaluateAll(expression)).find(value => value !== null && value !== undefined);
      const button = label => `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(label)})`;
      const draftFile = docPath(root, 'drafts/shared/files/index.html');
      const draftText = () => (fs.existsSync(draftFile) ? JSON.parse(fs.readFileSync(draftFile, 'utf8')).text ?? null : null);

      await page.evaluateAll(`document.querySelector('[data-dash-pencil]')?.click()`);
      assert.ok(await page.waitFor(`document.querySelector('[data-dash-mode]')`, 10000), 'the pencil did not start editing');
      const [x, y] = await one(`(() => { const h = document.querySelector('h1#title'); if (!h) return null; const range = document.createRange(); range.selectNodeContents(h); const r = range.getBoundingClientRect(); return [r.right - 2, r.y + r.height / 2]; })()`);
      await page.click(x, y);
      assert.ok(await page.waitFor(`document.querySelector('h1#title')?.isContentEditable || document.activeElement?.closest?.('[contenteditable="true"]')`, 5000), 'clicking the title did not start typing');
      await page.press('End');
      await page.type(' now');
      // Ending the typing makes a step; the step goes into the shared draft a moment later, with no Save.
      await page.press('Escape');
      assert.ok(await until(() => draftText()?.includes('Live now'), 10000), `the change did not reach the shared draft: ${draftText()}`);
      assert.equal(readDoc(root, 'files/index.html').text.includes('Live now'), false, 'the change was published');
      assert.equal(await one(`Boolean(${button('Save')})`), false, 'editing in the shared draft offers Save');
      const alone = `document.querySelector('.dash-edit-history[data-usable]')`;
      assert.ok(await page.waitFor(alone, 5000), 'Undo and Redo do not stand on their own');
      assert.equal(await one(`${alone}?.querySelector('button[aria-label="Undo"]')?.disabled ?? null`), false);

      // Undo takes the change back out of the draft; Redo puts it back.
      await page.evaluateAll(`${alone}?.querySelector('button[aria-label="Undo"]')?.click()`);
      assert.ok(await until(() => !draftText()?.includes('Live now'), 10000), `Undo left the change in the draft: ${draftText()}`);
      await page.evaluateAll(`${alone}?.querySelector('button[aria-label="Redo"]')?.click()`);
      assert.ok(await until(() => draftText()?.includes('Live now'), 10000), `Redo did not put the change back: ${draftText()}`);

      // Back to using the page, with auto-publish on and nobody else's changes in the draft, it goes live a moment later.
      await page.evaluateAll(`document.querySelector('button[aria-label="Use the page"]')?.click()`);
      assert.ok(await page.waitFor(`!document.querySelector('[data-dash-mode]')`, 10000), 'the pencil did not stop editing');
      assert.equal(await one(`document.querySelector('h1#title')?.textContent ?? null`), 'Live now');
      assert.ok(await until(() => readDoc(root, 'files/index.html').text.includes('Live now'), 15000), 'the hand edit was not published after the pencil was put down');
      assert.ok(await until(() => draftText() === null, 10000), `the published change is still in the draft: ${draftText()}`);
      assert.ok(await page.waitFor(button('Published'), 10000), 'no Published menu once the draft went live');
      assert.deepEqual(page.problems, []);
    } finally {
      await page?.close();
      await server.stop();
    }
  });

  it('publishes the agent’s changes to the shared draft when its turn ends, and holds them when auto-publish is off', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-turn-type');
    const turning = cli(dir, {
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-turn-state'), 'state'),
      HOME: tmpDir('data-turn-home'),
      OPEN_ARTIFACT_USER: 'E2E',
    });
    const titled = title => ({ text: `<main><h1 id="title">${title}</h1></main>\n` });
    const button = label => `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(label)})`;
    const said = `[...document.querySelectorAll('[role="status"][aria-live]')].map(region => region.textContent).join(' ')`;
    // A dashboard whose shared draft already holds a change, so the agent's turn writes into the draft.
    const dashboard = (name, settings) => {
      const root = path.join(tmpDir(`data-turn-${name}`), 'dashboard');
      writeDoc(root, 'dash/meta', { title: name });
      if (settings) writeDoc(root, 'dash/settings', settings);
      writeDoc(root, 'files/index.html', titled('Live'));
      writeDoc(root, 'drafts/shared', { v: 1, kind: 'edit', by: 'E2E', at: Date.now(), base: '' });
      writeDoc(root, 'drafts/shared/files/index.html', titled('Draft'));
      return root;
    };
    const pages = [];
    const waiters = [];
    try {
      for (const [name, settings, expected] of [['on', null, 'Agent'], ['off', { autoPublish: false }, 'Live']]) {
        const root = dashboard(name, settings);
        const opened = await turning.json(['open', root, '--json']);
        const page = await browser.load(opened.url, { ready: button('Publish'), ignore: [/\/favicon\.ico$/] });
        pages.push(page);
        // A waiting agent is there to work; its write starts a turn, and a quiet spell after it ends the turn.
        const waiter = await turning.start(['wait', root, '--timeout', '90'], { firstLine: false });
        waiters.push(waiter);
        // Everything read out from here on is kept, since a later message replaces an earlier one in the live region.
        await page.evaluateAll(`(() => { window.__said = []; new MutationObserver(() => window.__said.push(${said})).observe(document.body, { subtree: true, childList: true, characterData: true }); })()`);
        await turning.json(['write-db', root, JSON.stringify([{ op: 'set', path: 'drafts/shared/files/index.html', data: titled('Agent') }])]);
        assert.ok(await page.waitFor(`window.__said?.some(text => text.includes('The agent is working'))`, 15000), `${name}: no turn was read out`);
        assert.equal(readDoc(root, 'files/index.html').text, titled('Live').text, `${name}: the draft went live during the turn`);
        if (expected === 'Agent') {
          assert.ok(await until(() => readDoc(root, 'files/index.html').text === titled('Agent').text, 30000), 'the draft was not published when the turn ended');
          assert.ok(await page.waitFor(button('Published'), 10000), 'no Published menu once the draft went live');
        } else {
          // The host counts the agent busy for 8 s after its write, and the page waits 2 s more before the turn ends.
          await new Promise(resolve => setTimeout(resolve, 16000));
          assert.equal(readDoc(root, 'files/index.html').text, titled('Live').text, 'the draft was published with auto-publish off');
          assert.ok(await page.waitFor(button('Publish'), 5000), 'the held draft offers no Publish');
        }
        assert.deepEqual(page.problems, []);
      }
    } finally {
      for (const waiter of waiters) waiter.child.kill();
      for (const page of pages) await page.close();
      await turning.run(['stop']).catch(() => {});
    }
  });

  it('holds the agent’s changes when the shared draft also has someone else’s, or the dashboard changed after the draft began', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-hold-type');
    const turning = cli(dir, {
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-hold-state'), 'state'),
      HOME: tmpDir('data-hold-home'),
      OPEN_ARTIFACT_USER: 'E2E',
    });
    const titled = title => ({ text: `<main><h1 id="title">${title}</h1></main>\n` });
    const button = label => `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(label)})`;
    const said = `[...document.querySelectorAll('[role="status"][aria-live]')].map(region => region.textContent).join(' ')`;
    const pages = [];
    const waiters = [];
    try {
      for (const [name, head, notice] of [
        // Someone else edited the draft before the agent's turn.
        ['others', { editors: { Someone: true } }, 'The draft also has someone else’s changes, so it wasn’t published automatically.'],
        // The draft began from a dashboard that isn't the one there now.
        ['changed', { base: 'an-earlier-dashboard' }, 'This artifact changed after the draft was started.'],
      ]) {
        const root = path.join(tmpDir(`data-hold-${name}`), 'dashboard');
        writeDoc(root, 'dash/meta', { title: name });
        writeDoc(root, 'files/index.html', titled('Live'));
        writeDoc(root, 'drafts/shared', { v: 1, kind: 'edit', by: 'Someone', at: Date.now(), base: '', ...head });
        writeDoc(root, 'drafts/shared/files/index.html', titled('Draft'));
        const opened = await turning.json(['open', root, '--json']);
        const page = await browser.load(opened.url, { ready: button('Publish'), ignore: [/\/favicon\.ico$/] });
        pages.push(page);
        const waiter = await turning.start(['wait', root, '--timeout', '90'], { firstLine: false });
        waiters.push(waiter);
        // What is read out, and whether the notice has shown, are kept: both go again after a while.
        await page.evaluateAll(`(() => { window.__said = []; new MutationObserver(() => { window.__said.push(${said}); if (document.body.innerText.includes(${JSON.stringify(notice)})) window.__noticed = true; }).observe(document.body, { subtree: true, childList: true, characterData: true }); })()`);
        await turning.json(['write-db', root, JSON.stringify([{ op: 'set', path: 'drafts/shared/files/index.html', data: titled('Agent') }])]);
        assert.ok(await page.waitFor(`window.__said?.some(text => text.includes('The agent is working'))`, 15000), `${name}: no turn was read out`);
        // The turn ends, and the draft is held rather than published.
        assert.ok(await until(() => readDoc(root, 'drafts/shared').held === true, 30000), `${name}: the draft was not held when the turn ended`);
        assert.ok(await page.waitFor(`window.__noticed === true || document.body.innerText.includes(${JSON.stringify(notice)})`, 10000), `${name}: no word of why the draft was held`);
        assert.equal(readDoc(root, 'files/index.html').text, titled('Live').text, `${name}: the held draft went live`);
        assert.equal(readDoc(root, 'drafts/shared/files/index.html').text, titled('Agent').text, `${name}: the agent's change left the draft`);
        assert.ok(await page.waitFor(button('Publish'), 5000), `${name}: the held draft offers no Publish`);
        assert.deepEqual(page.problems, []);
      }
    } finally {
      for (const waiter of waiters) waiter.child.kill();
      for (const page of pages) await page.close();
      await turning.run(['stop']).catch(() => {});
    }
  });

  it('writes a source edited in Sources into the shared draft, where it waits for Publish with auto-publish off', T, async () => {
    const { createTypeServer, ConnectorsHost } = await import('../packages/type-server/src/index.ts');
    const home = tmpDir('data-source-draft-home');
    const host = new ConnectorsHost({ file: writeTestConnectors(path.join(home, 'connectors')) });
    const server = createTypeServer({ secret: 'data-source-draft', idleMs: 0, assetsDir: path.join(typePath(TYPE), 'scripts'), lanAddresses: () => [], connectors: host });
    let page;
    try {
      const root = path.join(tmpDir('data-source-draft'), 'dashboard');
      writeDoc(root, 'dash/meta', { title: 'Source draft' });
      writeDoc(root, 'dash/settings', { autoPublish: false });
      writeDoc(root, 'datasets/orders', {
        title: 'North orders',
        source: { kind: 'call', connector: 'sales', tool: 'run_sql', args: { query: "select * from orders where region = 'North'" } },
      });
      writeDoc(root, 'files/index.html', { text: '<main><h1>Orders</h1><p id="orders" data-source="orders">—</p></main>\n' });
      await server.listen();
      const opened = await server.open({ root, type: TYPE, title: 'Source draft' });
      const button = label => `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(label)})`;
      page = await browser.load(opened.url, { ready: "document.querySelector('[data-dash-sources] button')", timeout: 60000, settle: 500, ignore: [/\/favicon\.ico$/] });
      const draftFile = docPath(root, 'drafts/shared/datasets/orders');
      const inDraft = () => (fs.existsSync(draftFile) ? JSON.parse(fs.readFileSync(draftFile, 'utf8')) : null);

      // Sources, the orders row, and a description saved from its dialog.
      await page.evaluate(`document.querySelector('[data-dash-sources] button').click()`);
      const row = `document.querySelector('[data-source-row]')`;
      assert.ok(await page.waitFor(row, 10000), 'the Sources list shows no orders');
      await page.evaluate(`${row}.click()`);
      assert.ok(await page.waitFor(button('Edit North orders'), 10000), 'the source offers no Edit');
      await page.evaluate(`${button('Edit North orders')}.click()`);
      const field = `document.querySelector('[role="dialog"] textarea')`;
      assert.ok(await page.waitFor(field, 10000), 'the source has no Description field');
      await page.evaluate(`${field}.focus()`);
      await page.type('North only.');
      await page.evaluateAll(`[...(document.querySelector('[role="dialog"]')?.querySelectorAll('button[type="submit"]') ?? [])].find(b => b.textContent.trim() === 'Save')?.click()`);
      assert.ok(await until(() => inDraft()?.description === 'North only.', 10000), `the edit did not reach the shared draft: ${JSON.stringify(inDraft())}`);
      assert.equal(inDraft().title, 'North orders', 'the draft holds less than the whole source');
      assert.equal(readDoc(root, 'datasets/orders').description, undefined, 'the edit went live');
      assert.ok(await page.waitFor(button('Publish'), 10000), 'the draft with the edit offers no Publish');

      // Publish takes it live and empties the draft.
      await page.evaluateAll(`${button('Publish')}?.click()`);
      assert.ok(await until(() => readDoc(root, 'datasets/orders').description === 'North only.', 15000), 'Publish did not take the edit live');
      assert.ok(await until(() => inDraft() === null, 10000), 'the published edit is still in the draft');
      assert.deepEqual(page.problems, []);
    } finally {
      await page?.close();
      await server.stop();
      await host.close();
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

  it('runs a calculation that reads the filters again when a filter changes, and no other', T, async () => {
    // A calc over a file (which no filter reloads) that calls dash.params(): only the filters can make it run again.
    const { dir } = install(typePath(TYPE), 'data-calc-filter-type');
    const filtering = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-calc-filter-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-calc-filter'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [filtering.script, root], { env: filtering.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      const index = readDoc(root, 'files/index.html');
      writeDoc(root, 'files/index.html', {
        ...index,
        text: `${index.text}\n<p id="by-filter"><output data-draw="by-filter" data-source="signups_by_filter">—</output> <output data-draw="no-filter" data-source="signups_count">—</output></p>\n`,
      });
      const app = readDoc(root, 'files/app.js');
      writeDoc(root, 'files/app.js', {
        ...app,
        text: `${app.text}
window.__calcRuns = { filtered: 0, plain: 0 };
dash.calc('signups_by_filter', {
  inputs: ['signups'],
  fn: (signups) => { window.__calcRuns.filtered++; return (dash.params().region || 'all') + ':' + signups.length; },
});
dash.calc('signups_count', { inputs: ['signups'], fn: (signups) => { window.__calcRuns.plain++; return signups.length; } });
dash.draw('by-filter', el => { const d = dash.data('signups_by_filter'); el.textContent = d.status === 'ok' ? d.data : '—'; });
dash.draw('no-filter', el => { const d = dash.data('signups_count'); el.textContent = d.status === 'ok' ? d.data : '—'; });
`,
      });
      const opened = await filtering.json(['open', root, '--json']);
      const shown = `document.querySelector('[data-draw="by-filter"]')?.textContent`;
      page = await browser.load(opened.url, { ready: `/^all:\\d+$/.test(${shown} ?? '')`, timeout: 60000, ignore: [/\/favicon\.ico$/] });
      const first = await page.evaluate(shown);
      const rows = Number(first.split(':')[1]);
      assert.ok(rows > 0, `the calc saw no signups: ${first}`);
      const runs = async () => JSON.parse((await page.evaluateAll(`window.__calcRuns ? JSON.stringify(window.__calcRuns) : null`)).find(Boolean));
      const setFilter = region => page.evaluateAll(`typeof dash === 'object' && window.__calcRuns ? (dash.setParams({ region: ${JSON.stringify(region)} }), true) : false`);
      assert.deepEqual(await runs(), { filtered: 1, plain: 1 });

      // The page sets the filter: the calc that read it shows the new value, and the one that didn't never ran again.
      assert.ok((await setFilter('South')).includes(true), 'no frame holds the page’s dash');
      assert.ok(await page.waitFor(`${shown} === 'South:${rows}'`, 10000), `the calc kept its first answer: ${await page.evaluate(shown)}`);
      assert.deepEqual(await runs(), { filtered: 2, plain: 1 });
      assert.equal(await page.evaluate(`document.querySelector('[data-draw="no-filter"]').textContent`), String(rows));

      // Clear filters (the page's own button) takes it back.
      await page.evaluate(`document.getElementById('clear-filters').click()`);
      assert.ok(await page.waitFor(`${shown} === 'all:${rows}'`, 10000), `clearing the filter left ${await page.evaluate(shown)}`);
      assert.deepEqual(await runs(), { filtered: 3, plain: 1 });
    } finally {
      await page?.close();
      await filtering.run(['stop']).catch(() => {});
    }
  });

  it('names people in a reply with @: the list, arrows, Escape, a pick, and whom the reply names', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-mentions-type');
    const naming = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-mentions-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-mentions'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [naming.script, root], { env: naming.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      const at = new Date(0).toISOString();
      const file = path.join(root, 'comments.json');
      fs.writeFileSync(file, JSON.stringify({
        version: 1,
        threads: [{
          id: 'c_totals', anchor: '#dash-root', label: 'Page', location: { file: 'files/index.html', selector: '#dash-root' }, status: 'open', createdAt: at, updatedAt: at,
          messages: [
            { id: 'm_ana', author: { kind: 'person', name: 'Ana' }, text: 'Check the totals', at },
            { id: 'm_bob', author: { kind: 'person', name: 'Bob' }, text: 'Agreed', at },
          ],
        }],
      }));
      const opened = await naming.json(['open', root, '--json']);
      // No connectors here: the fixture's sales source cannot load, which is not what this is about.
      page = await browser.load(opened.url, { ready: "document.querySelector('#dash-root [data-source]')", timeout: 60000, settle: 1000, ignore: [/\/favicon\.ico$/, /\/_api\/mcp\/call$/] });
      const layer = "document.querySelector('[data-comment-layer]')?.shadowRoot";
      assert.ok(await page.waitFor(`${layer}?.querySelector('[data-comment-pin]')`, 10000), 'the thread has no pin');
      await page.evaluate(`${layer}.querySelector('[data-comment-pin]').click()`);
      const box = `${layer}?.querySelector('textarea[aria-label=Reply]')`;
      assert.ok(await page.waitFor(box, 5000), 'the card has no reply box');
      await page.evaluate(`${box}.focus()`);
      const list = `${layer}?.querySelector('[role=listbox][aria-label="Mention suggestions"]')`;
      const rows = `[...(${list}?.querySelectorAll('[role=option]') ?? [])].map(o => o.lastElementChild.textContent + (o.getAttribute('aria-selected') === 'true' ? '*' : ''))`;
      const said = `${layer}?.querySelector('[data-mention-status]')?.textContent`;

      // @ lists who the thread names (the viewer left out), the first row highlighted; the box points at it.
      await page.type('@');
      assert.ok(await page.waitFor(list, 5000), 'typing @ opened no list');
      assert.deepEqual(await page.evaluate(rows), ['Ana*', 'Bob']);
      // Drawn at the @, 288px wide, inside the window.
      const placed = await page.evaluate(`(() => {
        const l = ${list}.getBoundingClientRect(), b = ${box}.getBoundingClientRect();
        return { width: l.width, inside: l.top >= 0 && l.bottom <= innerHeight && l.left >= 0 && l.right <= innerWidth, near: Math.abs(l.left - b.left) < 24, shown: getComputedStyle(${list}).visibility };
      })()`);
      assert.deepEqual(placed, { width: 288, inside: true, near: true, shown: 'visible' });
      assert.equal(await page.evaluate(`${box}.getAttribute('aria-expanded')`), 'true');
      assert.equal(await page.evaluate(`${layer}.getElementById(${box}.getAttribute('aria-activedescendant'))?.lastElementChild.textContent`), 'Ana');
      assert.equal(await page.evaluate(said), 'Ana, 1 of 2');
      // The arrows move the highlight and wrap; the status says where it is.
      await page.press('ArrowDown');
      assert.ok(await page.waitFor(`(${said}) === 'Bob, 2 of 2'`, 2000), `ArrowDown: ${await page.evaluate(said)}`);
      await page.press('ArrowDown');
      assert.ok(await page.waitFor(`(${said}) === 'Ana, 1 of 2'`, 2000), `ArrowDown wraps: ${await page.evaluate(said)}`);
      // Escape closes the list only: the card and the draft stay.
      await page.press('Escape');
      assert.ok(await page.waitFor(`!${list}`, 2000), 'Escape left the list open');
      assert.equal(await page.evaluate(`${box}.value`), '@');
      assert.ok(await page.evaluate(`Boolean(${box})`), 'Escape closed the card');

      // A new @ opens it again; Enter puts the name in instead of sending.
      await page.press('Backspace');
      await page.type('@bo');
      assert.ok(await page.waitFor(`JSON.stringify(${rows}) === '["Bob*"]'`, 2000), `@bo: ${JSON.stringify(await page.evaluate(rows))}`);
      await page.press('Enter');
      assert.ok(await page.waitFor(`${box}.value === '@Bob ' && !${list}`, 2000), `the pick: ${await page.evaluate(`${box}.value`)}`);
      assert.ok(await page.waitFor(`(${said}) === 'Bob added'`, 2000), `after the pick: ${await page.evaluate(said)}`);
      assert.equal(await page.evaluate(`${layer}.querySelector('[data-mention-marks] .text-accent')?.textContent`), '@Bob', 'the box draws no mention');
      await page.type('please look');
      await page.press('Enter');

      const reply = () => JSON.parse(fs.readFileSync(file, 'utf8')).threads[0].messages[2];
      assert.ok(await until(() => reply()?.text === '@Bob please look', 10000), 'the reply was not saved');
      assert.deepEqual(reply().to, ['Bob']);
      // The card draws the name as a mention.
      assert.ok(await page.waitFor(`[...${layer}.querySelectorAll('[data-mention]')].some(m => m.textContent === '@Bob')`, 5000), 'the reply draws no mention');
      assert.deepEqual(page.problems, []);
    } finally {
      await page?.close();
      await naming.run(['stop']).catch(() => {});
    }
  });

  it('writes a comment on the whole dashboard from All comments, and tags a message sent to the agent', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-whole-type');
    const whole = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-whole-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-whole'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [whole.script, root], { env: whole.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      const at = new Date(0).toISOString();
      const file = path.join(root, 'comments.json');
      fs.writeFileSync(file, JSON.stringify({
        version: 1,
        threads: [{
          id: 'c_totals', anchor: '#dash-root', label: 'Page', location: { file: 'files/index.html', selector: '#dash-root' }, status: 'open', createdAt: at, updatedAt: at,
          messages: [
            // Sent to the agent with the box ticked: the card leads with the agent's tag.
            { id: 'm_ana', author: { kind: 'person', name: 'Ana' }, text: 'Check the totals', at, to: ['agent'] },
            { id: 'm_bob', author: { kind: 'person', name: 'Bob' }, text: 'Agreed', at },
          ],
        }],
      }));
      const opened = await whole.json(['open', root, '--json']);
      page = await browser.load(opened.url, { ready: "document.querySelector('#dash-root [data-source]')", timeout: 60000, settle: 1000, ignore: [/\/favicon\.ico$/, /\/_api\/mcp\/call$/] });
      const layer = "document.querySelector('[data-comment-layer]')?.shadowRoot";
      assert.ok(await page.waitFor(`${layer}?.querySelector('[data-comment-pin]')`, 10000), 'the thread has no pin');
      await page.evaluate(`${layer}.querySelector('[data-comment-pin]').click()`);
      assert.ok(await page.waitFor(`${layer}?.querySelector('[data-comment-card]')`, 5000), 'the pin opened no card');
      const tags = `[...${layer}.querySelectorAll('[data-sent-to-agent]')].map(t => t.textContent)`;
      assert.deepEqual(await page.evaluate(tags), ['@Agent'], 'only the message sent to the agent leads with its tag');
      await page.evaluate(`${layer}.querySelector('[data-comment-card] button[aria-label="Close"]').click()`);
      assert.ok(await page.waitFor(`!${layer}?.querySelector('[data-comment-card]')`, 5000), 'the card did not close');

      // All comments: "Add comment" opens a composer in the panel.
      const button = "document.querySelector('[data-comments-button]')?.shadowRoot";
      await page.evaluate(`${button}.querySelector('button[aria-label="Comment options"]').click()`);
      const showAll = `[...(${button}?.querySelectorAll('[role=menuitem]') ?? [])].find(el => el.textContent.includes('Show all comments'))`;
      assert.ok(await page.waitFor(showAll, 5000), 'the comments menu has no Show all comments');
      await page.evaluate(`${showAll}.click()`);
      // The closing menu hands the focus back to its button: let it, before the composer takes it.
      await page.waitFor(`${button}?.activeElement?.matches('[aria-label="Comment options"]')`, 2000);
      const panelRoot = "document.querySelector('[data-comments-panel-layer]')?.shadowRoot";
      const panel = `${panelRoot}?.querySelector('[data-comments-panel]')`;
      assert.ok(await page.waitFor(`${panel}?.querySelector('[data-comments-compose]')`, 5000), 'the panel has no Add comment');
      await page.evaluate(`${panel}.querySelector('[data-comments-compose]').click()`);
      const box = `${panel}?.querySelector('textarea[aria-label="Add a comment"]')`;
      assert.ok(await page.waitFor(`${box} && ${panelRoot}.activeElement === ${box}`, 5000), 'the composer did not open with the focus in it');
      // Escape closes the composer, not the panel.
      await page.press('Escape');
      assert.ok(await page.waitFor(`!${box} && ${panel}?.querySelector('[data-comments-compose]')`, 2000), 'Escape did not close the composer alone');
      await page.evaluate(`${panel}.querySelector('[data-comments-compose]').click()`);
      assert.ok(await page.waitFor(`${box} && ${panelRoot}.activeElement === ${box}`, 5000), 'the composer did not open again');

      // The @ list works here too, drawn over the panel.
      await page.type('@bo');
      const list = `${panelRoot}?.querySelector('[role=listbox][aria-label="Mention suggestions"]')`;
      assert.ok(await page.waitFor(list, 5000), 'typing @ opened no list');
      assert.ok(await page.evaluate(`${list}.closest('[data-layer-portal]') !== null`), 'the list is not in the layer portal');
      await page.press('Enter');
      assert.ok(await page.waitFor(`${box}.value === '@Bob '`, 2000), `the pick: ${await page.evaluate(`${box}.value`)}`);
      await page.type('the whole page is too busy');
      await page.press('Enter');

      const made = () => JSON.parse(fs.readFileSync(file, 'utf8')).threads.find((t) => t.id !== 'c_totals');
      assert.ok(await until(() => made()?.messages[0]?.text === '@Bob the whole page is too busy', 10000), 'the comment was not saved');
      const thread = made();
      assert.equal(thread.anchor, '');
      assert.equal(thread.label, 'Whole artifact');
      assert.deepEqual(thread.location, { file: 'files/index.html' });
      assert.deepEqual(thread.messages[0].to, ['Bob']);

      // Its row says what it is on; its card opens beside the panel; it has no pin.
      assert.ok(await page.waitFor(`${panel}?.querySelector('[data-comment-whole-artifact]')?.textContent.includes('Whole artifact')`, 5000), 'the row does not say Whole artifact');
      const card = `${panelRoot}?.querySelector('[data-comments-whole-card] [data-comment-card]')`;
      assert.ok(await page.waitFor(`${card}?.textContent.includes('the whole page is too busy')`, 5000), 'the new thread opened no card');
      const beside = await page.evaluate(`(() => {
        const c = ${card}.getBoundingClientRect(), p = ${panel}.getBoundingClientRect();
        return { left: c.right <= p.left, top: Math.abs(c.top - p.top) < 2 };
      })()`);
      assert.deepEqual(beside, { left: true, top: true });
      assert.equal(await page.evaluate(`${layer}?.querySelectorAll('[data-comment-pin]').length ?? 0`), 1, 'the whole-dashboard thread has a pin');
      assert.deepEqual(page.problems, []);
    } finally {
      await page?.close();
      await whole.run(['stop']).catch(() => {});
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

  it('lets the owner share a connector’s access from Sources, so a viewer’s page loads its query', T, async () => {
    // A viewer's page has no connectors: its live query stays unavailable until the owner picks Your access for the
    // sales connector. Then the owner's computer runs the approved query for the viewer, and the page shows its rows.
    const { createTypeServer, ConnectorsHost } = await import('../packages/type-server/src/index.ts');
    const home = tmpDir('data-shared-home');
    const connectors = writeTestConnectors(path.join(home, 'connectors'));
    const host = new ConnectorsHost({ file: connectors });
    const server = createTypeServer({
      secret: 'data-shared', idleMs: 0, assetsDir: path.join(typePath(TYPE), 'scripts'), viewerName: 'Ada Lovelace',
      lanAddresses: () => [], isLocal: req => !req.headers['x-test-guest'], connectors: host,
    });
    const rowsShown = `(window.__orders ?? null)`;
    const shown = async page => (await page.evaluateAll(rowsShown)).find(value => value !== null) ?? null;
    let owner;
    let guest;
    try {
      const root = path.join(tmpDir('data-shared'), 'dashboard');
      writeDoc(root, 'dash/meta', { title: 'Shared' });
      writeDoc(root, 'datasets/orders', {
        title: 'North orders',
        source: { kind: 'call', connector: 'sales', tool: 'run_sql', args: { query: "select * from orders where region = 'North'" } },
      });
      writeDoc(root, 'files/index.html', { text: '<main><h1>Orders</h1><p id="orders" data-source="orders">—</p></main>\n<script src="app.js"></script>\n' });
      writeDoc(root, 'files/app.js', {
        text: `dash.onData(() => {
  const orders = dash.data('orders');
  window.__orders = orders.status === 'ok' ? String(orders.rows.length) : orders.status;
  document.getElementById('orders').textContent = window.__orders;
});
`,
      });
      await server.listen();
      const opened = await server.open({ root, type: TYPE, title: 'Shared' });
      const invited = await fetch(new URL('/__open-artifact/share', opened.url), {
        method: 'POST',
        headers: { authorization: 'Bearer data-shared', 'content-type': 'application/json' },
        body: JSON.stringify({ id: opened.id, lan: true }),
      });
      assert.equal(invited.status, 200);
      const { links } = await invited.json();

      guest = await browser.load('about:blank');
      await guest.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      await guest.cdp('Page.navigate', { url: new URL(new URL(links.viewer.url).pathname, opened.url).href });
      assert.ok(await guest.waitFor("document.querySelector('input[name=name]')", 5000));
      await guest.evaluate(`document.querySelector('[name=name]').value = 'Vic'; document.querySelector('form').requestSubmit()`);
      assert.ok(await until(async () => { const value = await shown(guest); return value !== null && value !== 'loading' && value; }, 30000), 'the viewer’s page never read its source');
      assert.notEqual(await shown(guest), '4', 'the viewer’s page loaded the query with no shared access');

      owner = await browser.load(opened.url, { ready: "document.querySelector('[data-dash-sources] button')", timeout: 60000, settle: 500, ignore: [/\/favicon\.ico$/] });
      assert.ok(await until(async () => (await shown(owner)) === '4', 30000), 'the owner’s page did not load the query');
      await owner.evaluate(`document.querySelector('[data-dash-sources] button').click()`);
      const trigger = `document.querySelector('[data-run-as="sales"]')`;
      assert.ok(await owner.waitFor(trigger, 10000), 'the sales group has no Load data using');
      assert.equal(await owner.evaluate(`${trigger}.getAttribute('aria-label')`), 'sales: Load data using Each viewer');
      await clickOn(owner, trigger);
      const yours = `[...document.querySelectorAll('[role="menuitemcheckbox"]')].find(item => item.textContent.startsWith('Your access'))`;
      await clickOn(owner, yours, 'Your access');
      assert.ok(await owner.waitFor(`document.querySelector('[data-share-line]')?.textContent === 'You’re sharing access to 1 query.'`, 15000), 'the owner’s page does not say it shares');
      const mark = () => (fs.existsSync(docPath(root, 'dash/settings')) ? readDoc(root, 'dash/settings').shared?.sales : undefined);
      assert.ok(await until(mark, 15000), 'the share was not saved in dash/settings');
      assert.deepEqual({ ...mark(), at: 0 }, { id: 'owner', name: 'Ada Lovelace', at: 0 });
      // The owner's page loads the query through the share as well.
      assert.ok(await until(async () => (await shown(owner)) === '4', 30000), `the owner’s page shows ${await shown(owner)}`);
      // The approval stays beside the connectors, out of the dashboard's folder.
      assert.ok(fs.existsSync(path.join(path.dirname(connectors), 'connector-shares.json')));
      assert.equal(fs.readdirSync(root, { recursive: true }).some(name => String(name).includes('connector-shares')), false);

      // The viewer's page hears the share and loads the query with the owner's access.
      // A page in a tab behind another draws nothing new, so the viewer's comes to the front.
      await guest.cdp('Page.bringToFront');
      assert.ok(await until(async () => (await shown(guest)) === '4', 30000), `the viewer’s page shows ${await shown(guest)}`);
    } finally {
      await owner?.close();
      await guest?.close();
      await server.stop();
      await host.close();
    }
  });
});

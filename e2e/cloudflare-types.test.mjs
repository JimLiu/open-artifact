// End-to-end test of a person's own type published to the product Worker (`packages/host-cloudflare`) under
// `wrangler dev`, in Chrome: the catalog and the type's package in local D1 (in chunks), each artifact in its own
// Durable Object, a real daemon (`open-artifact daemon run`, its own home, port and user types folder) linked to it.
// The same flow as `e2e/host-types.test.mjs` on the Node site, with the synthetic fixture e2e/fixtures/site-type/team-poll.
//
// - The Link says types are taken (`hello.features.types`, `typesPublish`).
// - `publish` of an artifact of a type the site does not have is refused, naming the type and both commands;
//   `types publish` puts it in the catalog (its package in D1, whole); the artifact then publishes.
// - The owner opens it: its page on a page host, the type's own files; a second person joins by the viewer share link
//   (their own page host; the type's db rules let them vote, not change the question; no comments).
// - A new version reaches the open page (the hub tells the artifact's object), and the old version's rows go from D1.
// - `types unpublish` delists it (one artifact uses it): the artifact still opens; a new artifact of it is refused.
// - The type's page (`/t/<id>`, the site runs pages): for its publisher (its SKILL.md as text, the install command,
//   who sees it), for a second account per visibility (private: the unknown-id answer; site; link), signed out (a link
//   type shows, a publisher named by an email address is not named; anything else is sent to sign in); the package's
//   HEAD and GET with the package's length; the home page's Types tab; the site's MCP lists it with the third-party
//   notice and makes an artifact of it that opens, and refuses a delisted one; `types install <site>/t/<id>` from a
//   second home with no remote (the public package address).
//
// Skipped (with the reason) when deploy/cloudflare has no node_modules, with E2E_BROWSER=0, without Chrome, or before
// `npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { buildWorkers, d1, freePort, sqlValue, startWrangler, tokenHash, wranglerMissing } from './lib/cloudflare.mjs';
import { clickOn, cookieOf } from './lib/host-page.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 300000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const FIXTURE = path.join(repoRoot, 'e2e', 'fixtures', 'site-type', 'team-poll');
const UID = '0f6a3c1e-5b2d-4e8f-9a17-3c2b1d0e4f56';
const TALLY_UID = '5d1e7a2b-8c3f-4a6e-b9d0-1f2e3a4b5c6d';
const REDIRECT = 'http://127.0.0.1:9/callback';
const OWNER_KEY = `owner-${randomBytes(12).toString('hex')}`;
const SIGNING_KEY = randomBytes(32).toString('hex');
/** In the page's own frame (a page host: `<idlabel>--<24 base32>`). */
const IN_PAGE = "/^art-[0-9a-z]+--[a-z2-7]{24}\\.content\\.localhost$/.test(location.hostname)";
const IGNORE = [/favicon\.ico/, /not_granted|forbidden|not available in this view/i, /HTTP 40[134]/, /Failed to load resource/, /Content Security Policy|Refused to connect/];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function skip() {
  const missing = wranglerMissing();
  if (missing) return missing;
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/daemon/frame-host/client/shell.html', 'dist/daemon/frame-host/client/runtime.js'];
  const absent = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return absent.length ? `not built (npm run build): no ${absent.join(', ')}` : false;
}

/** `expression` in the page's own frame (undefined while there is none). */
const inPage = (page, expression) => page.evaluateAll(`(${IN_PAGE}) ? (${expression}) : undefined`).then(values => values.find(v => v !== undefined && v !== null), () => undefined);
const ready = page => until(async () => (await inPage(page, "document.getElementById('status')?.textContent")) === 'ready', 60000);

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** Copies the fixture type into `root` as `id`, at `version`, with another `uid` if given (as `e2e/host-types.test.mjs` does). */
function placeType(root, id, { uid, version = '1.0.0' } = {}) {
  const dir = path.join(root, id);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'artifact-type.json'), 'utf8'));
  manifest.slug = id;
  manifest.intents = [id];
  manifest.version = version;
  if (uid) manifest.uid = uid;
  fs.writeFileSync(path.join(dir, 'artifact-type.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replaceAll('1.0.0', version).replace('var key = "team-poll";', `var key = ${JSON.stringify(id)};`);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').replace('name: team-poll', `name: ${id}`));
  return dir;
}

describe('cloudflare: a person\'s own type on the product Worker under wrangler dev, in Chrome', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    buildWorkers();
    ctx.state = tmpDir('cloudflare-types');
    ctx.port = await freePort();
    ctx.app = `http://localhost:${ctx.port}`;
    ctx.server = await startWrangler({
      port: ctx.port,
      state: ctx.state,
      vars: { OA_APP_ORIGIN: ctx.app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${ctx.port}`, OA_SIGNING_KEYS: SIGNING_KEY, OA_OWNER_KEY: OWNER_KEY, OA_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'e2e', client_name: 'E2E client', redirect_uris: [REDIRECT] }]) },
      ready: async origin => (await fetch(`${origin}/__open-artifact/health`)).status === 200,
    });
    ctx.owner = await launch();
    ctx.guest = await launch();
  });

  after(async () => {
    await ctx.owner?.close();
    await ctx.guest?.close();
    await stop(ctx.daemon);
    await ctx.server?.stop();
    removeTmp();
  });

  it('publishes a type and its artifact from a local daemon, runs it per share role, follows a new version and delists it', T, async () => {
    const { owner, guest, app } = ctx;
    const wrangler = () => ctx.server.log().slice(-2500);

    // 1. The owner signs in, and links their computer.
    const home = await owner.load(`${app}/auth/sign-in#key=${OWNER_KEY}`, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(home, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await home.waitFor(`location.href === ${JSON.stringify(`${app}/`)}`, 20000), `not signed in: ${await home.evaluate('location.href')}`);
    const daemonHome = tmpDir('cf-types-daemon-home');
    const workspace = tmpDir('cf-types-agent');
    const userTypes = tmpDir('cf-types-types');
    const daemonPort = await freePort();
    const env = { ...process.env, OPEN_ARTIFACT_HOME: daemonHome, OPEN_ARTIFACT_USER_TYPES: userTypes, OPEN_ARTIFACT_BROWSER: 'none', OPEN_ARTIFACT_IDLE_MS: '0', OPEN_ARTIFACT_LINK_RESCAN_MS: '0', OPEN_ARTIFACT_LINK_RETRY_MS: '200', OPEN_ARTIFACT_HARNESS: 'cli', OPEN_ARTIFACT_SESSION: 'e2e-cf-types' };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_REMOTE_NAME', 'OPEN_ARTIFACT_PUBLISH', 'OPEN_ARTIFACT_PLUGIN_REMOTE', 'CLAUDECODE']) delete env[name];
    ctx.daemonLog = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(daemonPort)], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.daemonLog += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.daemonLog += chunk));
    assert.ok(await until(() => fs.existsSync(path.join(daemonHome, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.daemonLog}`);
    const cli = (args, onStderr) =>
      new Promise(resolve => {
        const child = spawn(process.execPath, [CLI, ...args], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => (stdout += chunk));
        child.stderr.on('data', chunk => {
          stderr += chunk;
          onStderr?.(stderr);
        });
        const timer = setTimeout(() => child.kill(), 90000);
        child.on('close', code => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
    const artifactTool = async args => {
      const out = await cli(['artifact', JSON.stringify(args)]);
      assert.equal(out.code, 0, out.stdout + out.stderr);
      return JSON.parse(out.stdout);
    };
    Object.assign(ctx, { cli, userTypes, homePage: home });
    let approval = null;
    const linking = cli(['remote', 'add', 'cloud', app], text => {
      approval ??= /^Open(?:ed)? (\S+) in (?:your|a) browser/m.exec(text)?.[1] ?? null;
    });
    assert.ok(await until(() => approval, 20000), 'remote add printed no address');
    const approve = await owner.load(approval, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: IGNORE });
    await clickOn(approve, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    const linked = await linking;
    assert.equal(linked.code, 0, linked.stderr);
    await approve.close();

    // 2. The Link says the site takes types, from its admins (the default).
    const remotes = JSON.parse(fs.readFileSync(path.join(daemonHome, 'remotes.json'), 'utf8')).remotes;
    const linkToken = Object.values(remotes)[0]?.accessToken;
    assert.ok(linkToken, 'the daemon keeps no Link token');
    const hello = await (await fetch(`${app}/api/open-artifact.link.hello`, { headers: { authorization: `Bearer ${linkToken}` } })).json();
    assert.deepEqual(hello.features, { pages: 1, types: 1 }, JSON.stringify(hello));
    assert.equal(hello.typesPublish, 'admins', JSON.stringify(hello));

    // 3. The owner's own type, and an artifact of it the agent makes; not on the site yet: refused.
    placeType(userTypes, 'team-poll');
    const made = await artifactTool({ action: 'publish', type_url: 'open-artifact://type/team-poll', title: 'Lunch poll', open: 'never' });
    const id = /art_[0-9a-z]+/.exec(made.url)?.[0];
    assert.ok(id, JSON.stringify(made));
    const refused = await cli(['publish', id]);
    assert.notEqual(refused.code, 0, refused.stdout);
    assert.match(refused.stderr, /open-artifact types publish team-poll --remote cloud/);
    assert.match(refused.stderr, /--with-type/);

    // 4. The person publishes the type (its package whole in D1), then the artifact.
    const typed = await cli(['types', 'publish', 'team-poll']);
    assert.equal(typed.code, 0, typed.stdout + typed.stderr + wrangler());
    assert.match(typed.stderr, /^Published to cloud \(http:\/\/localhost:\d+\): team-poll 1\.0\.0, visibility private\./m);
    const first = JSON.parse(typed.stdout);
    assert.equal(first.change, 'new');
    assert.equal(first.type.uid, UID);
    assert.deepEqual(d1(ctx.state, `SELECT version, complete FROM type_packages WHERE uid = '${UID}'`), [{ version: '1.0.0', complete: 1 }]);
    assert.ok(d1(ctx.state, `SELECT COUNT(*) AS n FROM type_package_chunks WHERE uid = '${UID}'`)[0].n >= 1);
    const published = await cli(['publish', id]);
    assert.equal(published.code, 0, published.stdout + published.stderr + wrangler());
    assert.equal(published.stdout.trim().split('\n')[0], `Published to cloud: ${app}/a/${id}`);

    // 5. The owner opens it: on a page host, no page token in the address, the type's own files.
    const page = await owner.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(page), `the page did not start: ${JSON.stringify(await page.evaluateAll('location.href + " " + (document.body?.innerText ?? "").slice(0, 200)'))}\nproblems: ${page.problems.slice(-10).join('\n')}\n${wrangler()}`);
    const href = await inPage(page, 'location.href');
    assert.match(href, /^http:\/\/art-[0-9a-z]+--[a-z2-7]{24}\.content\.localhost:\d+\/_f\/[^/]+\/$/, href);
    assert.equal(/v1\./.test(href), false, 'the page address holds no page token');
    assert.match(await inPage(page, 'pageTest.style()'), /system-ui/, 'the type\'s stylesheet loaded');
    assert.equal(await inPage(page, 'document.body.dataset.version'), '1.0.0');
    assert.deepEqual(JSON.parse(await inPage(page, "document.getElementById('me').textContent")), { owner: true, canEdit: true });
    assert.equal(await inPage(page, "pageTest.vote('owner', 'noodles')"), 'ok');
    assert.equal(await inPage(page, "pageTest.ask('Lunch?')"), 'ok');
    const ownerHost = new URL(href).host;

    // 6. A second person by the viewer link: their own page host; the type's db rules let them vote, not ask.
    const share = async body => page.evaluate(`fetch('/api/open-artifact.artifact.share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ id, ...body }))} }).then(r => r.json())`);
    const view = await share({ access: 'link', links: { viewer: true } });
    assert.ok(view.links?.viewer?.url, JSON.stringify(view));
    const join = await guest.load(view.links.viewer.url, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Vic');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`location.pathname === '/a/${id}'`, 20000), `the guest did not get to the page: ${await join.evaluate('location.href')}`);
    assert.ok(await ready(join), `the viewer's page did not start:\n${wrangler()}`);
    assert.notEqual(new URL(await inPage(join, 'location.href')).host, ownerHost, 'the viewer has a page host of their own');
    assert.ok(await until(async () => (await inPage(join, "document.querySelector('[data-vote=owner]')?.textContent")) === 'noodles', 20000), 'the viewer does not see the votes');
    assert.deepEqual(JSON.parse(await inPage(join, "document.getElementById('me').textContent")), { owner: false, canEdit: false });
    assert.equal(await inPage(join, "pageTest.vote('vic', 'soup')"), 'ok', 'the type\'s db rules let a viewer vote');
    assert.notEqual(await inPage(join, "pageTest.ask('Dinner?')"), 'ok', 'a viewer does not change the question');
    assert.equal(await inPage(join, 'pageTest.comments()'), false, 'no comments for a viewer');
    assert.ok(await until(async () => (await inPage(page, "document.querySelector('[data-vote=vic]')?.textContent")) === 'soup', 20000), 'the owner does not see the viewer\'s vote');

    // 7. A new version reaches both open pages, and the old version's rows go from D1. It carries 4 MiB of text that
    // hardly compresses, so its package is kept in several D1 rows and read back whole by the artifact's object.
    const nextDir = placeType(userTypes, 'team-poll', { version: '1.1.0' });
    fs.writeFileSync(path.join(nextDir, 'artifact-type', 'noise.txt'), randomBytes(3 * 1024 * 1024).toString('base64'));
    const next = await cli(['types', 'publish', 'team-poll']);
    assert.equal(next.code, 0, next.stdout + next.stderr + wrangler());
    assert.match(next.stderr, /^Published version 1\.1\.0 \(was 1\.0\.0\) to cloud/m);
    const moved = Date.now();
    assert.ok(await until(async () => (await inPage(page, 'document.body.dataset.version')) === '1.1.0', 45000), `the open page did not get the new version:\n${wrangler()}`);
    const took = Date.now() - moved;
    assert.ok(await ready(page));
    assert.ok(await until(async () => (await inPage(join, 'document.body.dataset.version')) === '1.1.0', 45000), 'the viewer\'s open page did not get the new version');
    assert.equal(await inPage(page, "document.querySelector('[data-vote=vic]')?.textContent"), 'soup', 'the data stays across the version');
    assert.deepEqual(d1(ctx.state, `SELECT version, complete FROM type_packages WHERE uid = '${UID}'`), [{ version: '1.1.0', complete: 1 }]);
    assert.deepEqual(d1(ctx.state, `SELECT DISTINCT version FROM type_package_chunks WHERE uid = '${UID}'`), [{ version: '1.1.0' }]);
    assert.ok(d1(ctx.state, `SELECT COUNT(*) AS n FROM type_package_chunks WHERE uid = '${UID}'`)[0].n >= 3, 'the package is in several rows');
    const noise = await inPage(page, "fetch('artifact-type/noise.txt').then(r => r.text()).then(t => t.length)");
    assert.equal(noise, Math.ceil((3 * 1024 * 1024) / 3) * 4, 'the large file is served whole');
    console.log(`# the open page moved to 1.1.0 ${took} ms after types publish returned`);
    await join.close();

    // The type's page address, from a computer signed in to the site: the type installs by that address, its package
    // through the Link (`types.archive`), with the publisher and the site named. (From a computer with no remote of
    // the site, see the next test: the public package address.)
    const installed = await cli(['types', 'install', `${app}/t/team-poll`, '--as', 'poll-from-site', '--yes']);
    assert.equal(installed.code, 0, installed.stdout + installed.stderr);
    assert.match(installed.stdout + installed.stderr, /through your remote/);
    assert.match(installed.stdout, /"poll-from-site"/);

    // 8. Unpublished while an artifact uses it: delisted, and the artifact still opens.
    const off = await cli(['types', 'unpublish', 'team-poll']);
    assert.equal(off.code, 0, off.stdout + off.stderr);
    const delisted = JSON.parse(off.stdout);
    assert.equal(delisted.removed, false);
    assert.equal(delisted.artifacts, 1);
    assert.equal(await inPage(page, 'document.body.dataset.version'), '1.1.0', 'the open page keeps running');
    await page.close();
    const again = await owner.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(again), `a delisted type's artifact no longer opens:\n${wrangler()}`);
    assert.equal(await inPage(again, 'document.body.dataset.version'), '1.1.0');
    await again.close();
    // A new artifact of it is refused until the type is published again.
    const later = await artifactTool({ action: 'publish', type_url: 'open-artifact://type/team-poll', title: 'Later poll', open: 'never' });
    const laterId = /art_[0-9a-z]+/.exec(later.url)?.[0];
    const laterOut = await cli(['publish', laterId]);
    assert.notEqual(laterOut.code, 0);
    assert.match(laterOut.stderr, /unpublished/);
  });

  it('shows a type\'s page per visibility and signed out, the Types tab, streams its package, offers it in the site\'s MCP, and installs it with no remote', T, async () => {
    // Builds on the test above: its site, the owner's Chrome and computer (ctx.cli, ctx.userTypes); team-poll is delisted.
    assert.ok(ctx.cli && ctx.userTypes, 'runs after the test above');
    const { owner, app, cli } = ctx;
    const wrangler = () => ctx.server.log().slice(-2500);
    const nav = { accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
    const pageUrl = `${app}/t/team-tally`;
    const detailOf = (id, cookie) => fetch(`${app}/api/open-artifact.type?id=${id}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    const pageOf = (id, cookie) => fetch(`${app}/t/${id}`, { headers: { ...nav, ...(cookie ? { cookie } : {}) }, redirect: 'manual' });

    // 1. A second type of the owner's, private (the default). 4 MiB of text that hardly compresses: its package is in
    // several D1 rows, and the download below streams them.
    const tallyDir = placeType(ctx.userTypes, 'team-tally', { uid: TALLY_UID });
    fs.writeFileSync(path.join(tallyDir, 'artifact-type', 'noise.txt'), randomBytes(3 * 1024 * 1024).toString('base64'));
    const typed = await cli(['types', 'publish', 'team-tally']);
    assert.equal(typed.code, 0, typed.stdout + typed.stderr + wrangler());
    assert.match(typed.stderr, /team-tally 1\.0\.0, visibility private\./);
    const ownerRow = d1(ctx.state, `SELECT u.id, u.name FROM types t JOIN users u ON u.id = t.publisher_user WHERE t.uid = '${TALLY_UID}'`)[0];
    assert.ok(ownerRow?.name, 'the publisher has a name');
    // Its SKILL.md is kept beside the package when it is stored (no package read for the page).
    assert.match(d1(ctx.state, `SELECT skill FROM type_skills WHERE uid = '${TALLY_UID}' AND version = '1.0.0'`)[0]?.skill ?? '', /name: team-tally/);

    // 2. Its publisher's page: their name, the install command, its SKILL.md as text, who sees it.
    const tp = await owner.load(pageUrl, { ready: "document.querySelector('[data-type-page=team-tally]')", ignore: IGNORE });
    assert.equal(await tp.evaluate("document.querySelector('[data-testid=type-page-publisher]').textContent"), ownerRow.name);
    assert.equal(await tp.evaluate("document.querySelector('[data-testid=type-page-install]').textContent"), `open-artifact types install ${pageUrl}`);
    assert.match(await tp.evaluate("document.querySelector('[data-testid=type-page-skill]').textContent"), /name: team-tally/, 'its SKILL.md, as text');
    assert.equal(await tp.evaluate("document.querySelector('[data-testid=type-page-skill]').children.length"), 0, 'drawn as text, not HTML');
    assert.ok(await tp.evaluate("!!document.querySelector('[data-site-type-manage]')"), 'its publisher manages it here');
    const ownerCookie = `oa_session=${await cookieOf(tp, app, 'oa_session')}`;
    const headers = (await pageOf('team-tally', ownerCookie)).headers;
    assert.equal(headers.get('x-frame-options'), 'DENY');
    assert.match(headers.get('content-security-policy') ?? '', /script-src 'self' 'sha256-/);

    // 3. A second account (put in the catalog directly: no sign-in provider here).
    const bob = { id: `usr_e2e${randomBytes(6).toString('hex')}`, token: randomBytes(32).toString('base64url') };
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 86400_000).toISOString();
    d1(ctx.state, `INSERT INTO users (id, name, email, email_verified, site_role, created_at) VALUES (${[bob.id, 'Bob Member', 'bob@example.com', 1, 'member', now].map(sqlValue).join(', ')}); INSERT INTO sessions (id_hash, user_id, created_at, seen_at, expires_at) VALUES (${[tokenHash(bob.token), bob.id, now, now, later].map(sqlValue).join(', ')});`);
    const bobCookie = `oa_session=${bob.token}`;
    const listedTo = async cookie => (await (await fetch(`${app}/api/open-artifact.types`, { headers: { cookie } })).json()).types.map(t => t.id);

    // Private: Bob gets the answer an unknown id gets; signed out, both are sent to sign in.
    const [hidden, unknown] = [await detailOf('team-tally', bobCookie), await detailOf('nope-kit', bobCookie)];
    assert.equal(hidden.status, 404);
    assert.equal(hidden.status, unknown.status);
    assert.deepEqual(await hidden.json(), await unknown.json());
    assert.equal((await pageOf('team-tally', bobCookie)).status, (await pageOf('nope-kit', bobCookie)).status);
    assert.deepEqual(await listedTo(bobCookie), []);
    for (const id of ['team-tally', 'nope-kit']) {
      const anon = await pageOf(id);
      assert.equal(anon.status, 303, `${id}: signed out, private`);
      assert.match(anon.headers.get('location') ?? '', /sign-in/);
    }

    // Site: listed to Bob and shown to him; still not to someone signed out.
    const visibility = async label => {
      await clickOn(tp, `[...document.querySelectorAll('[data-site-type-manage] button')].find(b => b.textContent === ${JSON.stringify(label)})`, label);
    };
    await visibility('Everyone on this site');
    assert.ok(await until(async () => (await detailOf('team-tally', bobCookie)).status === 200, 15000), `site: Bob does not see it\n${wrangler()}`);
    assert.deepEqual(await listedTo(bobCookie), ['team-tally']);
    const bobPage = await pageOf('team-tally', bobCookie);
    assert.equal(bobPage.status, 200);
    assert.match(await bobPage.text(), /"typePage":/);
    assert.equal((await pageOf('team-tally')).status, 303, 'site: signed out, sent to sign in');

    // Link: shown to anyone with the address (the site allows public access), not listed to Bob.
    await visibility('Anyone with the link');
    assert.ok(await until(async () => (await pageOf('team-tally')).status === 200, 15000), 'link: signed out, it does not show');
    assert.deepEqual(await listedTo(bobCookie), []);
    assert.equal((await detailOf('team-tally', bobCookie)).status, 200);
    const anonDetail = await (await detailOf('team-tally')).json();
    assert.equal(anonDetail.publisher.name, ownerRow.name, 'a publisher with a name of their own is named');
    assert.equal(anonDetail.manages, false);
    // A publisher named by an email address is not named to someone signed out (signed in, they are).
    d1(ctx.state, `UPDATE users SET name = 'owner@example.com' WHERE id = ${sqlValue(ownerRow.id)}`);
    assert.equal((await (await detailOf('team-tally')).json()).publisher.name, null);
    assert.equal((await (await detailOf('team-tally', bobCookie)).json()).publisher.name, 'owner@example.com');
    const publisherHeader = async cookie => (await fetch(`${app}/api/open-artifact.types.package?id=team-tally`, { method: 'HEAD', headers: cookie ? { cookie } : {} })).headers.get('x-open-artifact-type-publisher');
    assert.equal(await publisherHeader(), null, "the package names no email address to someone signed out");
    assert.equal(await publisherHeader(bobCookie), encodeURIComponent('owner@example.com'));
    d1(ctx.state, `UPDATE users SET name = ${sqlValue(ownerRow.name)} WHERE id = ${sqlValue(ownerRow.id)}`);
    await tp.close();

    // 4. The package, signed out: HEAD and GET with its length; GET the whole package, its sha256 the catalog's.
    const stored = d1(ctx.state, `SELECT bytes, sha256 FROM types WHERE uid = '${TALLY_UID}'`)[0];
    assert.ok(d1(ctx.state, `SELECT COUNT(*) AS n FROM type_package_chunks WHERE uid = '${TALLY_UID}'`)[0].n >= 3, 'the package is in several rows');
    const pkgUrl = `${app}/api/open-artifact.types.package?id=team-tally`;
    const head = await fetch(pkgUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(stored.bytes), 'HEAD says its length');
    assert.equal(head.headers.get('content-type'), 'application/zip');
    const got = await fetch(pkgUrl);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-length'), String(stored.bytes), 'GET says its length (a fixed-length stream)');
    assert.equal(got.headers.get('content-disposition'), 'attachment; filename="team-tally-1.0.0.oatype"');
    const body = new Uint8Array(await got.arrayBuffer());
    assert.equal(body.byteLength, stored.bytes);
    assert.equal(createHash('sha256').update(body).digest('hex'), stored.sha256);

    // 5. The home page's Types tab lists the owner's types, each a link to its page; a delisted one marked.
    const tab = await owner.load(`${app}/#types`, { ready: "document.querySelector('[data-home-site-types]')", ignore: IGNORE });
    assert.ok(await tab.waitFor("document.querySelector('[data-site-type=team-tally]')?.getAttribute('href') === '/t/team-tally'", 15000), 'the Types tab lists team-tally');
    assert.ok(await tab.evaluate("!!document.querySelector('[data-site-type=team-poll]')"), 'its publisher sees a delisted one');
    await tab.close();

    // 6. The site's MCP (OAuth in the owner's Chrome): it lists the published type with the third-party notice, makes
    // an artifact of it that opens, and refuses the delisted one.
    const server = await (await fetch(`${app}/.well-known/oauth-authorization-server`)).json();
    const verifier = randomBytes(32).toString('base64url');
    const resource = (await (await fetch(`${app}/.well-known/oauth-protected-resource/mcp`)).json()).resource;
    const params = { response_type: 'code', client_id: 'e2e', redirect_uri: REDIRECT, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 's1', resource };
    const consent = await owner.load(`${server.authorization_endpoint}?${new URLSearchParams(params)}`, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: [...IGNORE, /127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|net::ERR/] });
    await clickOn(consent, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    let redirected = null;
    assert.ok(
      await until(async () => {
        const { targetInfos } = await consent.cdp('Target.getTargets').catch(() => ({ targetInfos: [] }));
        const target = targetInfos.map(t => t.url).find(u => u.startsWith(REDIRECT)) ?? (await consent.evaluate('location.href').catch(() => ''));
        redirected = target.startsWith(REDIRECT) ? new URL(target) : null;
        return redirected;
      }, 15000),
      'the consent did not redirect to the client',
    );
    await consent.close().catch(() => undefined);
    const tokenRes = await fetch(server.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: redirected.searchParams.get('code'), client_id: 'e2e', redirect_uri: REDIRECT, code_verifier: verifier }) });
    assert.equal(tokenRes.status, 200);
    const access = (await tokenRes.json()).access_token;
    const mcp = async (method, params = {}) => {
      const res = await fetch(`${app}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method, params }) });
      const text = await res.text();
      const answer = (res.headers.get('content-type') ?? '').includes('event-stream') ? JSON.parse(/^data: (.*)$/m.exec(text)[1]) : JSON.parse(text);
      if (answer.error) throw new Error(`${method}: ${JSON.stringify(answer.error)}`);
      return answer.result;
    };
    await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    const call = async (name, args) => {
      const result = await mcp('tools/call', { name, arguments: args });
      return { isError: !!result.isError, text: result.content[0].text };
    };
    const listed = JSON.parse((await call('Artifact', { action: 'list', scope: 'types' })).text).types;
    const tally = listed.find(t => t.id === 'team-tally');
    assert.ok(tally, listed.map(t => t.id).join(','));
    assert.equal(tally.source, 'site');
    assert.equal(tally.published_by, ownerRow.name);
    assert.ok(tally.third_party_notice, JSON.stringify(tally));
    assert.ok(!listed.some(t => t.id === 'team-poll'), 'a delisted type is not offered');
    const made = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/team-tally', title: 'Tally by MCP' });
    assert.equal(made.isError, false, made.text);
    const created = JSON.parse(made.text);
    assert.match(created.instructions, /SKILL\.md \(team-tally 1\.0\.0\), the publisher's text\.\n\n---\n\n# Team poll/, 'its SKILL.md (kept on the site), after the notice that it is the publisher\'s');
    const madeId = /art_[0-9a-z]+/.exec(created.url)?.[0];
    assert.ok(madeId, made.text);
    assert.deepEqual(d1(ctx.state, `SELECT type FROM artifacts WHERE id = ${sqlValue(madeId)}`), [{ type: 'team-tally' }]);
    const opened = await owner.load(`${app}/a/${madeId}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(opened), `the MCP-made artifact did not start:\n${wrangler()}`);
    assert.equal(await inPage(opened, 'document.body.dataset.version'), '1.0.0');
    await opened.close();
    const refused = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/team-poll', title: 'Later' });
    assert.match(refused.text, /unpublished/, refused.text);

    // 7. A second home with no remote: the type installs from the page's address, by the public package address.
    const home2 = tmpDir('cf-types-home2');
    const env2 = { ...process.env, OPEN_ARTIFACT_HOME: home2, OPEN_ARTIFACT_USER_TYPES: path.join(home2, 'own-types'), OPEN_ARTIFACT_BROWSER: 'none', OPEN_ARTIFACT_HARNESS: 'cli' };
    for (const name of ['OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_REMOTE_NAME', 'OPEN_ARTIFACT_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT']) delete env2[name];
    const cli2 = args =>
      new Promise(resolve => {
        const child = spawn(process.execPath, [CLI, ...args], { env: env2, cwd: home2, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => (stdout += chunk));
        child.stderr.on('data', chunk => (stderr += chunk));
        const timer = setTimeout(() => child.kill(), 90000);
        child.on('close', code => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
    try {
      const install = await cli2(['types', 'install', pageUrl, '--as', 'tally-public', '--yes']);
      assert.equal(install.code, 0, install.stdout + install.stderr);
      assert.match(install.stderr, /its public address, without signing in/);
      assert.match(install.stderr, new RegExp(`published by: ${ownerRow.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.equal(JSON.parse(install.stdout).source, pageUrl);
      assert.ok(fs.existsSync(path.join(home2, 'types', 'tally-public', 'artifact-type.json')), "installed in the second home's types");
      assert.ok(!fs.existsSync(path.join(home2, 'remotes.json')) || Object.keys(JSON.parse(fs.readFileSync(path.join(home2, 'remotes.json'), 'utf8')).remotes ?? {}).length === 0, 'no remote in that home');
    } finally {
      // The command started that home's daemon: stop it.
      await cli2(['daemon', 'stop']);
    }
  });
});

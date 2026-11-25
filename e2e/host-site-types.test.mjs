// End-to-end test of the local home page's types on the sites this computer is connected to (`types.sites`), in Chrome.
//
// The real Node host (`packages/host`) on a free port, and four real daemons (`open-artifact daemon run`, each its own
// home, port and user types folder): Ada's, Ben's and Cara's, each connected to the site with a Link token minted by
// `open-artifact-host link-token`, and one connected to nothing. The type is synthetic (e2e/fixtures/site-type/team-poll).
//
// - Ada publishes team-poll to the site for everyone there (`types publish --visibility site`).
// - Ben's home page, Types tab: a section for the site (its name and host) with team-poll, who published it, and a link
//   to its page on the site; Install opens the Install dialog on its page address (the publisher and the site named,
//   the SKILL.md in full), nothing is installed before the confirm, then the row says installed and the type is listed
//   among Ben's own.
// - Ada's home page shows it as published from her computer, with no button.
// - Ada publishes a new version: Ben's row offers Update, which goes through the dialog, and turns to installed.
// - Cara has another type (another uid) under the same id: her row offers installing it under another id; the dialog's
//   form has the page filled in, she names the id, confirms, and the row says installed as that id.
// - A home connected to no site says where the types on a site would appear.
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 180000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const FIXTURE = path.join(repoRoot, 'e2e', 'fixtures', 'site-type', 'team-poll');
const IGNORE = [/favicon\.ico/];

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `not built (npm run build): no ${missing.join(', ')}` : false;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** Clicks the middle of the element once it has stopped moving (two frames apart). */
async function clickOn(page, selector) {
  const box = await page.evaluate(`(async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    let last = null;
    for (let i = 0; i < 20; i++) {
      await frame();
      const r = el.getBoundingClientRect();
      const now = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      if (last && last.x === now.x && last.y === now.y) return now;
      last = now;
    }
    return last;
  })()`);
  assert.ok(box, `nothing matches ${selector}`);
  await page.click(box.x, box.y);
}

describe('the types on the connected sites, on the local home page in Chrome', { skip: skip() }, () => {
  const ctx = { daemons: [] };

  before(async () => {
    const data = path.join(tmpDir('host-site-types'), 'data');
    ctx.port = await freePort();
    ctx.app = `http://localhost:${ctx.port}`;
    ctx.hostEnv = { ...process.env, OA_DATA_DIR: data, OA_PORT: String(ctx.port), OA_BIND: '127.0.0.1', OA_APP_ORIGIN: ctx.app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${ctx.port}`, OA_TYPES_PUBLISH: 'members' };
    for (const name of ['OA_OWNER_KEY', 'OA_SIGNING_KEYS', 'OA_CONTENT_SAME_SITE', 'OA_PAGE_NETWORK']) delete ctx.hostEnv[name];
    // Each person's Link token, minted before the host serves (the same data folder).
    ctx.tokens = {};
    for (const email of ['ada@example.com', 'ben@example.com', 'cara@example.com']) {
      const minted = spawnSync(process.execPath, [MAIN, 'link-token', '--user', email, '--label', 'e2e'], { env: ctx.hostEnv, encoding: 'utf8', timeout: 60000 });
      assert.equal(minted.status, 0, `link-token failed: ${minted.stderr}`);
      ctx.tokens[email] = /OPEN_ARTIFACT_REMOTE_TOKEN=(\S+)/.exec(minted.stdout)?.[1];
      assert.ok(ctx.tokens[email], 'link-token printed no token');
    }
    ctx.log = '';
    ctx.host = spawn(process.execPath, [MAIN, 'serve'], { env: ctx.hostEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.host.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.host.stderr.on('data', chunk => (ctx.log += chunk));
    assert.ok(await until(() => /listening on/.test(ctx.log), 30000), `the host did not start:\n${ctx.log}`);
    ctx.browser = await launch({ width: 1100, height: 800 });
  });

  after(async () => {
    await ctx.browser?.close();
    for (const child of ctx.daemons) await stop(child);
    await stop(ctx.host);
    removeTmp();
  });

  /** A daemon of its own (home, port, user types), connected to the site as `email` when given. */
  async function daemon(name, email) {
    const home = tmpDir(`${name}-home`);
    const workspace = tmpDir(`${name}-ws`);
    const types = tmpDir(`${name}-types`);
    const installed = tmpDir(`${name}-installed`);
    const port = await freePort();
    const env = { ...process.env, OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_USER_TYPES: types, OPEN_ARTIFACT_INSTALLED_TYPES: installed, OPEN_ARTIFACT_BROWSER: 'none', OPEN_ARTIFACT_IDLE_MS: '0' };
    for (const v of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'CLAUDECODE', 'OPEN_ARTIFACT_PUBLISH', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_REMOTE_NAME', 'NODE_TEST_CONTEXT', 'NODE_OPTIONS']) delete env[v];
    if (email) Object.assign(env, { OPEN_ARTIFACT_REMOTE: ctx.app, OPEN_ARTIFACT_REMOTE_TOKEN: ctx.tokens[email], OPEN_ARTIFACT_REMOTE_NAME: 'cloud' });
    let log = '';
    const child = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(port)], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemons.push(child);
    child.stdout.on('data', chunk => (log += chunk));
    child.stderr.on('data', chunk => (log += chunk));
    assert.ok(await until(() => fs.existsSync(path.join(home, 'daemon.json')), 30000), `the daemon did not start:\n${log}`);
    const state = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
    const cli = args =>
      new Promise(resolve => {
        const run = spawn(process.execPath, [CLI, ...args], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        run.stdout.on('data', chunk => (stdout += chunk));
        run.stderr.on('data', chunk => (stderr += chunk));
        const timer = setTimeout(() => run.kill(), 90000);
        run.on('close', code => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
    if (email) assert.ok(await until(async () => /"signedIn": true/.test((await cli(['remote', 'status', '--json'])).stdout), 30000), `${name}'s daemon did not sign in:\n${log}`);
    return { home, types, installed, state, cli, log: () => log };
  }

  /** The home page of `computer`, on its Types tab. */
  async function typesTab(computer) {
    const page = await ctx.browser.load(`${computer.state.url}/`, { ready: "!!document.querySelector('[role=tab]')", ignore: IGNORE });
    const tab = "[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Types')";
    const box = await page.evaluate(`(() => { const r = ${tab}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page.click(box.x, box.y);
    assert.ok(await page.waitFor("!!document.querySelector('[data-testid=new-type]')", 10000), 'the Types tab did not open');
    return page;
  }

  it("lists the site's types on another computer's home page, installs one through the dialog, and its publisher's home shows it as published from there", T, async () => {
    const ada = await daemon('ada', 'ada@example.com');
    const ben = await daemon('ben', 'ben@example.com');
    const lone = await daemon('lone', null);

    // Ada publishes her type for everyone on the site.
    fs.cpSync(FIXTURE, path.join(ada.types, 'team-poll'), { recursive: true });
    const published = await ada.cli(['types', 'publish', 'team-poll', '--visibility', 'site']);
    assert.equal(published.code, 0, published.stdout + published.stderr);
    const pageUrl = `${ctx.app}/t/team-poll`;

    // Ben's home page: the site's section, the type with its publisher, and a link to its page there.
    const home = await typesTab(ben);
    try {
      const row = '[data-connected-site=cloud] [data-connected-site-type="team-poll"]';
      assert.ok(await home.waitFor(`!!document.querySelector('${row}')`, 20000), `no row for team-poll: ${await home.evaluate("document.body.innerText.slice(-600)")}`);
      assert.equal(await home.evaluate(`document.querySelector('${row}').dataset.standing`), 'new');
      assert.match(await home.evaluate("document.querySelector('[data-connected-site=cloud] h2').textContent"), new RegExp(`cloud.*localhost:${ctx.port}`));
      assert.match(await home.evaluate(`document.querySelector('${row} [data-testid=site-type-publisher]').textContent`), /ada@example\.com/);
      assert.equal(await home.evaluate(`document.querySelector('${row} [data-testid=site-type-page]').getAttribute('href')`), pageUrl);
      assert.equal(await home.evaluate(`document.querySelector('${row} [data-testid=site-type-page]').getAttribute('rel')`), 'noopener noreferrer');
      assert.equal(await home.evaluate(`document.querySelector('${row} [data-testid=site-type-page]').getAttribute('target')`), '_blank');
      assert.ok(await home.evaluate("!document.querySelector('[data-type-id=\"team-poll\"]')"), 'not among Ben\'s own types yet');

      // Install: the dialog reads the page address; the publisher and the site named, the SKILL.md in full.
      await clickOn(home, `${row} [data-testid=site-type-install]`);
      assert.ok(await home.waitFor("!!document.querySelector('[data-testid=type-preview-skill]')", 20000), `no preview: ${await home.evaluate("document.querySelector('[role=alert]')?.textContent ?? document.body.innerText.slice(-400)")}`);
      assert.equal(await home.evaluate("document.querySelector('[data-testid=type-preview-source]').textContent"), pageUrl);
      assert.match(await home.evaluate("document.querySelector('[data-testid=type-preview-publisher]').textContent"), /ada@example\.com/);
      assert.match(await home.evaluate("document.querySelector('[data-testid=type-preview-site]').textContent"), /cloud/);
      assert.equal(await home.evaluate("document.querySelector('[data-testid=type-preview-skill]').textContent"), fs.readFileSync(path.join(FIXTURE, 'SKILL.md'), 'utf8'));
      assert.equal(fs.existsSync(path.join(ben.installed, 'team-poll')), false, 'nothing is installed before the confirm');
      await clickOn(home, '[data-testid=type-install-confirm]');

      // The row turns to installed (a label, no button), and the type is Ben's now.
      assert.ok(await home.waitFor(`document.querySelector('${row}')?.dataset.standing === 'installed'`, 20000), `the row did not turn to installed: ${await home.evaluate(`document.querySelector('${row}')?.outerHTML.slice(0, 400)`)}`);
      assert.equal(await home.evaluate(`document.querySelector('${row} [data-testid=site-type-label]').textContent`), 'Installed');
      assert.equal(await home.evaluate(`document.querySelectorAll('${row} button').length`), 0, 'no button on an installed one');
      assert.ok(await home.waitFor("!!document.querySelector('[data-type-id=\"team-poll\"][data-type-scope=installed]')", 10000), 'listed among Ben\'s types');
      const index = JSON.parse(fs.readFileSync(path.join(ben.home, 'types.json'), 'utf8'));
      assert.equal(index.types['team-poll'].source, pageUrl);
      assert.deepEqual(home.problems, []);
    } finally {
      await home.close();
    }

    // Ada's home page: published from her computer, no button.
    const adaHome = await typesTab(ada);
    try {
      const row = '[data-connected-site=cloud] [data-connected-site-type="team-poll"]';
      assert.ok(await adaHome.waitFor(`document.querySelector('${row}')?.dataset.standing === 'published-here'`, 20000), `not shown as published from here: ${await adaHome.evaluate("document.body.innerText.slice(-600)")}`);
      assert.equal(await adaHome.evaluate(`document.querySelector('${row} [data-testid=site-type-label]').textContent`), 'Published from this computer');
      assert.equal(await adaHome.evaluate(`document.querySelectorAll('${row} button').length`), 0);
    } finally {
      await adaHome.close();
    }

    // Ada publishes a new version: Ben's row offers the update of his installed one, which goes through the dialog.
    const manifestPath = path.join(ada.types, 'team-poll', 'artifact-type.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '1.1.0' }, null, 2) + '\n');
    const republished = await ada.cli(['types', 'publish', 'team-poll']);
    assert.equal(republished.code, 0, republished.stdout + republished.stderr);
    const updating = await typesTab(ben);
    try {
      const row = '[data-connected-site=cloud] [data-connected-site-type="team-poll"]';
      assert.ok(await updating.waitFor(`document.querySelector('${row}')?.dataset.standing === 'update'`, 20000), `no update offered: ${await updating.evaluate(`document.querySelector('${row}')?.outerHTML.slice(0, 400)`)}`);
      assert.match(await updating.evaluate(`document.querySelector('${row} [data-testid=site-type-update]').textContent`), /1\.1\.0/);
      await clickOn(updating, `${row} [data-testid=site-type-update]`);
      assert.ok(await updating.waitFor("!!document.querySelector('[data-testid=type-preview-skill]')", 20000), 'no preview of the update');
      const before = JSON.parse(fs.readFileSync(path.join(ben.installed, 'team-poll', 'artifact-type.json'), 'utf8'));
      assert.equal(before.version, '1.0.0', 'nothing is updated before the confirm');
      await clickOn(updating, '[data-testid=type-install-confirm]');
      assert.ok(await updating.waitFor(`document.querySelector('${row}')?.dataset.standing === 'installed'`, 20000), 'the row did not turn to installed after the update');
      assert.equal(JSON.parse(fs.readFileSync(path.join(ben.installed, 'team-poll', 'artifact-type.json'), 'utf8')).version, '1.1.0');
      assert.deepEqual(updating.problems, []);
    } finally {
      await updating.close();
    }

    // A computer where another type (another uid) already has the id: install it under another id, through the dialog.
    const cara = await daemon('cara', 'cara@example.com');
    fs.cpSync(FIXTURE, path.join(cara.types, 'team-poll'), { recursive: true });
    const own = JSON.parse(fs.readFileSync(path.join(cara.types, 'team-poll', 'artifact-type.json'), 'utf8'));
    fs.writeFileSync(path.join(cara.types, 'team-poll', 'artifact-type.json'), JSON.stringify({ ...own, uid: '9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e' }, null, 2) + '\n');
    const clashing = await typesTab(cara);
    try {
      const row = '[data-connected-site=cloud] [data-connected-site-type="team-poll"]';
      assert.ok(await clashing.waitFor(`document.querySelector('${row}')?.dataset.standing === 'clash'`, 20000), `not shown as a clash: ${await clashing.evaluate(`document.querySelector('${row}')?.outerHTML.slice(0, 400)`)}`);
      await clickOn(clashing, `${row} [data-testid=site-type-install-as]`);
      assert.ok(await clashing.waitFor("!!document.querySelector('[data-testid=install-type-clash]')", 10000), 'no hint to give another id');
      assert.equal(await clashing.evaluate("document.querySelector('[data-testid=install-type-form] input[name=url]').value"), pageUrl);
      assert.equal(await clashing.evaluate("!!document.querySelector('[data-testid=type-preview]')"), false, 'not read before an id is given');
      await clickOn(clashing, '[data-testid=install-type-form] input[name=as]');
      await clashing.type('team-poll-site');
      await clickOn(clashing, '[data-testid=install-type-form] button[type=submit]');
      assert.ok(await clashing.waitFor("!!document.querySelector('[data-testid=type-preview-skill]')", 20000), `no preview: ${await clashing.evaluate("document.querySelector('[role=alert]')?.textContent ?? ''")}`);
      await clickOn(clashing, '[data-testid=type-install-confirm]');
      assert.ok(await clashing.waitFor(`document.querySelector('${row}')?.dataset.standing === 'installed'`, 20000), 'the row did not turn to installed');
      assert.equal(await clashing.evaluate(`document.querySelector('${row} [data-testid=site-type-label]').textContent`), 'Installed as team-poll-site');
      const index = JSON.parse(fs.readFileSync(path.join(cara.home, 'types.json'), 'utf8'));
      assert.equal(index.types['team-poll-site'].source, pageUrl);
      assert.equal(JSON.parse(fs.readFileSync(path.join(cara.types, 'team-poll', 'artifact-type.json'), 'utf8')).uid, '9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e', 'its own type is left as it was');
      assert.deepEqual(clashing.problems, []);
    } finally {
      await clashing.close();
    }

    // A computer connected to no site: one line saying where they would appear.
    const loneHome = await typesTab(lone);
    try {
      assert.ok(await loneHome.waitFor("!!document.querySelector('[data-connected-sites=none]')", 15000), 'no line for a computer without sites');
      assert.match(await loneHome.evaluate("document.querySelector('[data-connected-sites=none]').textContent"), /Connect a site/);
    } finally {
      await loneHome.close();
    }
  });
});

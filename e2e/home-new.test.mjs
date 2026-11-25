// End-to-end test of making an artifact without an agent, in Chrome: a real daemon (in this process, from source, in a
// temporary home) and no agent session at all. The home page's "New" makes a blank doc, which opens in its editor
// rather than the empty state with the hand-over prompt; an empty whiteboard made earlier opens on the empty state,
// and its "Start blank" opens the editor. A blank Design System's "Start by hand" goes to its Colors section. Design stays
// in the "make with an agent" group.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 90000 };
/** The Shell framed the artifact's page, and the empty state is not shown. */
const IN_EDITOR = "location.pathname.startsWith('/a/') && !!document.querySelector('iframe[name]') && !document.querySelector('[data-testid=empty-artifact]')";

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  for (const ui of ['shell', 'home']) {
    if (!fs.existsSync(path.join(repoRoot, 'dist', 'daemon', ui, 'index.html'))) return `the ${ui} page is not built (npm run build)`;
  }
  return false;
}

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

describe('making an artifact without an agent', { skip: skip() }, () => {
  const ctx = {};
  /** A real click in the middle of the element `selector` of the top page, once it has stopped moving. */
  const clickOn = async (page, selector) => {
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
  };

  before(async () => {
    const tmp = tmpDir('home-new');
    ctx.home = path.join(tmp, 'home');
    ctx.workspace = path.join(tmp, 'home-workspace');
    fs.mkdirSync(ctx.home, { recursive: true });
    // The home page creates in the home workspace: here, not ~/OpenArtifact.
    fs.writeFileSync(path.join(ctx.home, 'settings.json'), JSON.stringify({ homeWorkspace: ctx.workspace }));
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_TRUST_PROJECTS']) delete process.env[name];
    const port = await freePort();
    Object.assign(process.env, {
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: path.join(tmp, 'types'),
      OPEN_ARTIFACT_INSTALLED_TYPES: path.join(tmp, 'installed-types'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmp, 'servers'),
      OPEN_ARTIFACT_PORT: String(port),
    });
    const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
    ctx.daemon = await startDaemon({ port, idleMs: 0, quiet: true, browse: null });
    ctx.browser = await launch({ width: 1100, height: 800 });
  });

  after(async () => {
    await ctx.browser?.close();
    await ctx.daemon?.close();
    removeTmp();
  });

  it('New → Docs makes a blank doc and opens its editor, owned by nobody', T, async () => {
    const page = await ctx.browser.load(`${ctx.daemon.origin}/`, { ready: "!!document.querySelector('[data-testid=new-artifact]:not([disabled])')", ignore: [/favicon\.ico/] });
    try {
      assert.deepEqual(page.problems, []);
      await clickOn(page, '[data-testid=new-artifact]');
      assert.ok(await page.waitFor("!!document.querySelector('[data-testid=create-form]')", 10000), 'the dialog opened');
      // Both groups are offered: Docs to start right away, Design to make with an agent.
      assert.equal(await page.evaluate("!!document.querySelector('[data-testid=create-group-blank] [data-type-id=docs]')"), true);
      assert.equal(await page.evaluate("!!document.querySelector('[data-testid=create-group-agent] [data-type-id=design]')"), true);
      await clickOn(page, '[data-testid=create-type][data-type-id=docs]');
      assert.ok(await page.waitFor("document.querySelector('[data-testid=create-type][data-type-id=docs]')?.getAttribute('aria-checked') === 'true'", 5000), 'Docs is chosen');
      await clickOn(page, '[data-testid=create-form] input[name=title]');
      await page.type('Meeting notes');
      await clickOn(page, '[data-testid=create-form] button[type=submit]');
      assert.ok(await page.waitFor(IN_EDITOR, 30000), `not in the editor: ${await page.evaluate("location.href + ' ' + (document.querySelector('[role=alert]')?.textContent ?? '') + (document.querySelector('[data-testid=empty-artifact]') ? ' (empty state)' : '')")}`);
      const id = await page.evaluate("location.pathname.split('/')[2]");
      const record = ctx.daemon.store.require(id);
      assert.equal(record.type, 'docs');
      assert.equal(record.owner, null);
      assert.equal(record.createdBy, null);
      assert.ok(fs.existsSync(path.join(record.root, 'doc', 'doc.json')), 'the doc has its starting files');
      assert.ok(record.root.startsWith(ctx.workspace), record.root);
    } finally {
      await page.close();
    }
  });

  it('an empty whiteboard opens on the empty state; Start blank opens its editor', T, async () => {
    // Made empty, as artifacts.create without blank makes one (what New did before for every type).
    const made = await fetch(`${ctx.daemon.origin}/api/open-artifact.artifacts.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ctx.daemon.origin },
      body: JSON.stringify({ type: 'whiteboard', title: 'Retro' }),
    }).then((r) => r.json());
    assert.ok(made.id, JSON.stringify(made));
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${made.id}`, { ready: "!!document.querySelector('[data-testid=start-blank]')", ignore: [/favicon\.ico/] });
    try {
      assert.deepEqual(page.problems, []);
      assert.equal(await page.evaluate("!!document.querySelector('[data-testid=empty-artifact] textarea')?.value"), true, 'the hand-over prompt is there too');
      await clickOn(page, '[data-testid=start-blank]');
      assert.ok(await page.waitFor(IN_EDITOR, 30000), `not in the editor: ${await page.evaluate("document.querySelector('[data-testid=empty-artifact] [role=status]')?.textContent ?? ''")}`);
      const record = ctx.daemon.store.require(made.id);
      assert.equal(record.owner, null);
      assert.ok(fs.existsSync(path.join(record.root, 'db', 'board', 'meta.json')), 'the board has its starting files');
    } finally {
      await page.close();
    }
  });

  it('a blank Design System: its welcome page\'s Start by hand goes to the Colors section', T, async () => {
    const made = await fetch(`${ctx.daemon.origin}/api/open-artifact.artifacts.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ctx.daemon.origin },
      body: JSON.stringify({ type: 'design-system', title: 'Brand', blank: true }),
    }).then((r) => r.json());
    assert.ok(made.id, JSON.stringify(made));
    const button = "document.querySelector('[data-testid=ds-start-by-hand]')";
    const colorsTop = "document.getElementById('ds-page-colors')?.getBoundingClientRect().top";
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${made.id}`, { ready: `!!${button}`, ignore: [/favicon\.ico/] });
    try {
      assert.deepEqual(page.problems, []);
      const inFrame = async (expression) => (await page.evaluateAll(`${button} ? (${expression}) : undefined`)).find((v) => v !== undefined);
      const before = await inFrame(colorsTop);
      assert.ok(before > 300, `Colors starts below the welcome page (${before})`);
      await inFrame(`(${button}.click(), true)`);
      assert.ok(await page.waitFor(`${button} && ${colorsTop} < 200`, 10000), `Colors is not in view: ${await inFrame(colorsTop)}`);
    } finally {
      await page.close();
    }
  });

  it('an empty design shows no Start blank: an agent builds it', T, async () => {
    const made = await fetch(`${ctx.daemon.origin}/api/open-artifact.artifacts.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ctx.daemon.origin },
      body: JSON.stringify({ type: 'design', title: 'Landing' }),
    }).then((r) => r.json());
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${made.id}`, { ready: "!!document.querySelector('[data-testid=empty-artifact]')", ignore: [/favicon\.ico/] });
    try {
      assert.equal(await page.evaluate("!!document.querySelector('[data-testid=start-blank]')"), false);
    } finally {
      await page.close();
    }
  });
});

/**
 * The app beside an agent app (harness-kit's `createHarness`, as a fake host), on the same daemon:
 *
 * 1. Open Folder… on a folder an agent's artifact had (its record forgotten by the library first): the artifact it
 *    adds is owned by nobody (`owner` null).
 * 2. An artifact an agent's session made and owns, opened in the app and edited there, still has that owner.
 * 3. An agent writes to a Docs artifact open in the app, through the agent's own path (the `Artifact` tool's `call`
 *    of the type's `update`): the tab shows the new words without being loaded again.
 *
 * Throwaway profile, free port that is not 4800; the agent app is closed before the daemon is stopped by the pid its
 * own daemon.json names.
 */
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { RUNTIME, cleanEnv, daemonState, freePort, leftovers, makeProfile, sleep, stopDaemon, until } from './lib/env.mjs';
import { CARRIED } from './lib/registry.mjs';
import { launchApp, library } from './lib/app.mjs';
import { createHarness } from '../../../packages/harness-kit/src/index.ts';

const T = { timeout: 180_000 };
const js = (value) => JSON.stringify(value);
const inDocs = (url) => /\/docs\/[0-9a-f]+\//.test(url);
const SESSION = { session: 'acc-1' };

describe('acceptance: the app beside an agent app', () => {
  let profile;
  let port;
  let app;
  let agent;

  /** The agent's `Artifact` tool, as its session calls it; the tool's answer, parsed. */
  const tool = async (args) => {
    const out = await agent.call('Artifact', args, SESSION);
    const text = Array.isArray(out?.content) ? out.content.find((c) => c.type === 'text')?.text : undefined;
    assert.ok(!out?.isError, `Artifact ${args.action}: ${text ?? js(out)}`);
    if (out?.structuredContent) return out.structuredContent;
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    }
    return out;
  };
  const record = (id) => library(daemonState(profile), `artifact?id=${id}`);
  const tab = async (id) => (await app.state()).tabs.find((t) => t.id === id);
  const docText = (view) => view.inFrame(inDocs, `document.querySelector('.doc-text')?.innerText ?? ''`);
  /** An agent's new doc, owned by its session, with some words in it. */
  const agentDoc = async (title, words) => {
    const made = await tool({ action: 'publish', type_url: 'open-artifact://type/docs', title, open: 'never' });
    assert.ok(made.url?.startsWith('open-artifact://artifact/'), js(made).slice(0, 300));
    made.id = made.url.slice('open-artifact://artifact/'.length);
    const created = await tool({ action: 'call', url: made.url, name: 'create', args: { call: { name: title, doc: { markdown: `# ${title}\n\n${words}` } } } });
    assert.equal(created.ok, true, js(created).slice(0, 400));
    const rec = await record(made.id);
    assert.equal(rec.owner?.harness, 'test-agent-app', js(rec.owner));
    return { ...made, root: rec.root, owner: rec.owner };
  };

  /** The doc's first tab, as an agent reads it (`read` with no tab lists the tabs). */
  const firstTab = async (url) => {
    const read = await tool({ action: 'call', url, name: 'read', args: { call: {} } });
    const id = read.files?.[0]?.id;
    assert.ok(id, js(read).slice(0, 400));
    return id;
  };
  /** The tab's words as Markdown, as an agent reads them (the host's long form of a tab's read). */
  const markdownOf = async (url) => {
    const tabId = await firstTab(url);
    return js(await tool({ action: 'call', url, name: 'read', args: { call: { ref: { object: 'node', id: tabId }, payload: { kind: 'markdown' } } } }));
  };

  before(async () => {
    profile = makeProfile('oa-desktop-accept-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    agent = await createHarness({
      harness: 'test-agent-app',
      runtime: { dir: RUNTIME, version: CARRIED },
      home: profile.oaHome,
      daemon: { env: cleanEnv(profile, port), timeoutMs: 60_000 },
      reconnect: { minMs: 300, maxMs: 1000 },
      log: () => {},
    });
    await agent.ready();
    await agent.attach({ ...SESSION, workspace: profile.artifacts, title: 'Acceptance chat' });
  });

  after(async () => {
    try {
      await agent?.close();
    } catch {
      // Gone already.
    }
    await app?.quit({ force: true });
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('1. Open Folder… on the folder of an agent\'s artifact, forgotten by the library: owned by nobody', T, async () => {
    const made = await agentDoc('Owned once', 'An agent made this.');
    assert.ok(made.owner, 'the agent\'s artifact has no owner');
    const forgot = await library(daemonState(profile), 'artifacts.delete', { id: made.id });
    assert.ok(forgot, js(forgot));
    assert.ok(existsSync(join(made.root, '.artifact.json')), 'forgetting it touched the folder');
    const added = await app.command('open-folder', made.root);
    assert.equal(added.ok, true, js(added));
    const id = added.value.id;
    assert.ok(await until(async () => (await tab(id))?.status === 'ready', 30_000), js(await tab(id)));
    const rec = await record(id);
    assert.equal(rec.root, made.root);
    assert.equal(rec.type, 'docs');
    assert.equal(rec.owner, null, `Open Folder… kept an owner: ${js(rec.owner)}`);
  });

  it('2. an agent\'s artifact opened and edited in the app keeps its owner', T, async () => {
    const made = await agentDoc('Kept owner', 'Start.');
    assert.equal((await app.open(made.id)).ok, true);
    const view = await app.view(made.id);
    assert.ok(await until(async () => (await tab(made.id))?.status === 'ready', 30_000));
    assert.ok(await view.waitInFrame(inDocs, `document.querySelector('.doc-text')?.innerText.includes('Start.')`, 30_000), 'the doc did not show its words');
    const placed = await view.inFrame(
      inDocs,
      `(() => { const p = [...document.querySelectorAll('.doc-text p')].at(-1); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return document.activeElement === root; })()`,
    );
    assert.equal(placed, true);
    await view.type(' Edited in the app.');
    let read = '';
    assert.ok(await until(async () => (read = await markdownOf(made.url)).includes('Edited in the app.'), 20_000), `the edit did not reach the doc: ${read.slice(0, 400)}`);
    assert.ok(await until(async () => (await tab(made.id))?.saved === 'saved' && !(await tab(made.id)).unsaved, 20_000), js(await tab(made.id)));
    const rec = await record(made.id);
    assert.deepEqual(
      { harness: rec.owner?.harness, session: rec.owner?.session },
      { harness: made.owner.harness, session: made.owner.session },
      `the owner changed: ${js(made.owner)} → ${js(rec.owner)}`,
    );
  });

  it('3. an agent\'s write to a doc open in the app shows in its tab without a reload', T, async () => {
    const made = await agentDoc('Live words', 'Before the agent writes.');
    assert.equal((await app.open(made.id)).ok, true);
    const view = await app.view(made.id);
    assert.ok(await until(async () => (await tab(made.id))?.status === 'ready', 30_000));
    assert.ok(await view.waitInFrame(inDocs, `document.querySelector('.doc-text')?.innerText.includes('Before the agent writes.')`, 30_000));
    await view.evaluate(`window.__marker = 'same page'`);
    await view.inFrame(inDocs, `(window.__frameMarker = 'same frame', true)`);
    const loads = app.lines.filter((l) => l.includes(`tab ${made.id}: loaded`)).length;

    const words = 'Written by the agent while the tab was open.';
    const tabId = await firstTab(made.url);
    const wrote = await tool({
      action: 'call',
      url: made.url,
      name: 'update',
      args: { call: { ref: { object: 'node', id: tabId }, payload: { ops: [{ op: 'insert', target: { kind: 'root' }, side: 'end', source: { markdown: words } }] } } },
    });
    assert.notEqual(wrote.ok, false, js(wrote).slice(0, 400));
    assert.ok((await markdownOf(made.url)).includes(words), 'the agent\'s write did not land');
    assert.ok(await view.waitInFrame(inDocs, `document.querySelector('.doc-text')?.innerText.includes(${js(words)})`, 20_000), `the tab does not show the agent's words: ${await docText(view)}`);
    await sleep(300);
    assert.equal(await view.evaluate('window.__marker'), 'same page', 'the Shell was loaded again');
    assert.equal(await view.inFrame(inDocs, 'window.__frameMarker'), 'same frame', 'the editor was loaded again');
    assert.equal(app.lines.filter((l) => l.includes(`tab ${made.id}: loaded`)).length, loads, 'the tab was loaded again');
  });
});

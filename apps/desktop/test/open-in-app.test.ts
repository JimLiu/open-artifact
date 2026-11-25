import type { Harness } from '@open-artifact/harness-kit';
import { createHarness } from '@open-artifact/harness-kit';
import type { DaemonState } from '@open-artifact/protocol';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * "Agents' artifacts open in this app" (Settings, Artifacts; the daemon's `openInDesktop`): an agent app that shows no
 * pages itself (Claude Code, through the harness kit, with no `open` of its own) asks for an artifact to be shown.
 * Off (the default): nothing opens in the app, and the step is the browser's as before (here `OPEN_ARTIFACT_BROWSER`
 * is `none`, so the browser is never started). On, with the app connected: a tab of the artifact opens in the app and
 * the browser is not used. The switch is the person's: the daemon refuses it from an agent's session.
 *
 * Throwaway profile, a free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp } from './lib/app.ts';
import { daemonState, freePort, leftovers, makeProfile, sleep, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 180_000 };
const js = (value: unknown) => JSON.stringify(value);
const SESSION = { session: 'open-in-app', workspace: null as string | null };

describe("agents' artifacts open in this app (the setting)", () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let agent: Harness;
  let state: DaemonState | null;

  const by = (testid: string) => `document.querySelector('[data-testid=${js(testid)}]')`;
  const daemonLog = () => readFileSync(join(profile.oaHome, 'logs', 'daemon.log'), 'utf8');
  const tabIds = async () => (await app.state()).tabs.map((t) => t.id);
  const setting = () => (JSON.parse(readFileSync(join(profile.oaHome, 'settings.json'), 'utf8')) as { openInDesktop?: boolean }).openInDesktop;
  const make = async (title: string) => {
    const made = await agent.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/docs', title }, SESSION);
    const id = String(made.url).replace('open-artifact://artifact/', '');
    assert.ok(id.startsWith('art_'), js(made));
    return id;
  };
  const open = (id: string) => agent.call('Artifact', { action: 'open', url: `open-artifact://artifact/${id}` }, SESSION);

  before(async () => {
    profile = makeProfile('oa-desktop-open-in-app-');
    SESSION.workspace = profile.artifacts;
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    state = daemonState(profile);
    assert.ok(state?.url, 'no daemon');
    // No `open`: this agent app shows no pages; its profile's step is the browser.
    agent = await createHarness({ harness: 'claude-code', home: profile.oaHome, autoStart: false, reconnect: { minMs: 200, maxMs: 1000 }, log: () => {} });
    await agent.ready();
    await agent.attach(SESSION);
  });

  after(async () => {
    try {
      agent?.close(); // the kit's close() returns nothing
    } catch {}
    await app?.quit({ force: true }).catch(() => {});
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it("off (the default): an agent's Artifact open opens no tab; the step stays the browser's", T, async () => {
    const before = await tabIds();
    const id = await make('Off note');
    const result = await open(id);
    assert.notEqual(result.opened_in, 'desktop', js(result));
    assert.notEqual(result.opened, true, js(result));
    await sleep(1500);
    assert.deepEqual(await tabIds(), before, 'a tab opened with the setting off');
    assert.doesNotMatch(daemonLog(), /Open Artifact Desktop/, 'the daemon handed a page to the app with the setting off');
  });

  it("the setting is refused from an agent's session (only the person changes it)", T, async () => {
    const refused = await fetch(`${present(state).url}/api/open-artifact.desktop.settings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${present(state).token}`, 'content-type': 'application/json', 'x-open-artifact-agent': 'claude-code:open-in-app' },
      body: js({ openInDesktop: true }),
    });
    assert.equal(refused.status, 403, await refused.text());
    const read = await fetch(`${present(state).url}/api/open-artifact.desktop.settings`, { headers: { authorization: `Bearer ${present(state).token}` } });
    assert.deepEqual(await read.json(), { openInDesktop: false });
  });

  it('on (the switch in Settings), the app connected: the artifact opens in a tab here and the browser is not used', T, async () => {
    await app.chrome.clickOn(by('nav-settings'));
    assert.ok(await app.chrome.waitFor(`!!${by('open-in-desktop')}`, 10_000), 'no switch in Settings');
    assert.equal(await app.chrome.evaluate<string | null>(`${by('open-in-desktop')}.getAttribute('aria-checked')`), 'false');
    await app.chrome.clickOn(by('open-in-desktop'));
    assert.ok(await app.chrome.waitFor(`${by('open-in-desktop')}.getAttribute('aria-checked') === 'true'`, 10_000), 'the switch did not turn on');
    assert.ok(await until(() => setting() === true, 10_000), "not saved in the daemon's settings.json");
    await app.chrome.evaluate<boolean>(
      `${by('settings-dialog')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), true`,
    );
    assert.ok(await app.chrome.waitFor(`!${by('settings-dialog')}`, 5000), 'Settings did not close');

    const id = await make('On note');
    const result = await open(id);
    assert.equal(result.opened, true, js(result));
    assert.equal(result.opened_in, 'desktop', js(result));
    assert.ok(await until(async () => (await tabIds()).includes(id), 15_000), 'no tab of the artifact in the app');
    assert.equal((await app.state()).current, id, "the artifact's tab is not in front");
    assert.match(daemonLog(), new RegExp(`open open-artifact://artifact/${id}: shown in Open Artifact Desktop`));
    assert.doesNotMatch(daemonLog(), /the browser instead/);
  });
});

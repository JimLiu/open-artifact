/**
 * One app per profile, and `open-artifact://` links:
 *
 * - A second start in the same home hands its arguments to the app running and exits 0 at once: its `--open <id>`
 *   and its `open-artifact://artifact/<id>` open as tabs in the first; the first says it would come to the front (test
 *   mode leaves the screen alone). A link of another form is refused and logged, and nothing opens.
 * - Two apps in different homes run side by side.
 * - A link as a start's argument opens its artifact; macOS's `open-url` (called as the system would, test mode's
 *   `desktop.test.openUrl`) and the named command `open-url` do too; links of other forms are refused.
 * - Nothing registers the scheme: the app's log never says it did, and the source has no `setAsDefaultProtocolClient`
 *   or `lsregister` (the unit tests check the source).
 *
 * Throwaway profiles, free ports that are not 4800; the daemons are stopped by the pid their own daemon.json names.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.mjs';
import { launchApp, library } from './lib/app.mjs';

const T = { timeout: 120_000 };
const js = (value) => JSON.stringify(value);
const link = (id) => `open-artifact://artifact/${id}`;

describe('one app per profile; open-artifact:// links', () => {
  let profile;
  let other;
  let port;
  let otherPort;
  let first;
  let elsewhere;
  const ids = {};
  const extra = [];

  const tabIds = async (app) => (await app.state()).tabs.map((t) => t.id);
  const make = async (title) => {
    const made = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title, blank: true });
    assert.ok(made.id, js(made));
    ids[title] = made.id;
    return made.id;
  };
  /** A second start in `profile`'s home: it must leave at once, with 0. */
  const secondStart = async (args) => {
    const started = Date.now();
    const second = await launchApp(profile, port, { args });
    extra.push(second);
    assert.ok(await until(() => second.exited, 20_000), `the second start did not leave:\n${second.lines.join('\n')}`);
    assert.equal(second.exited.code, 0, js(second.exited));
    assert.ok(second.lines.some((l) => /another instance runs for this profile/.test(l)), second.lines.join('\n'));
    assert.equal(second.lines.some((l) => /\[desktop\] ready /.test(l)), false, 'the second start started an app of its own');
    return Date.now() - started;
  };

  before(async () => {
    profile = makeProfile('oa-desktop-instance-');
    other = makeProfile('oa-desktop-instance-b-');
    port = await freePort();
    otherPort = await freePort();
    first = await launchApp(profile, port);
    await first.line(/\[desktop\] ready /);
    await first.connect();
    for (const title of ['Atlas', 'Beacon', 'Cobalt', 'Dune', 'Ember', 'Fjord']) await make(title);
  });

  after(async () => {
    for (const app of [first, elsewhere, ...extra]) await app?.quit({ force: true }).catch(() => {});
    await stopDaemon(profile);
    await stopDaemon(other);
    const left = [...leftovers(profile), ...leftovers(other)];
    if (!process.env.OA_DESKTOP_KEEP) {
      rmSync(profile.root, { recursive: true, force: true });
      rmSync(other.root, { recursive: true, force: true });
    }
    assert.deepEqual(left, [], 'processes of the test profiles still run');
  });

  it('a second start with --open hands it to the first and exits 0 at once; the first opens the tab', T, async () => {
    const took = await secondStart(['--open', ids.Atlas]);
    assert.ok(took < 15_000, `the second start took ${took} ms`);
    assert.ok(await until(async () => (await tabIds(first)).includes(ids.Atlas), 15_000), js(await first.state()));
    await first.line(/second start: \[/);
    await first.line(/second start: the window would come to the front \(test mode: not shown\)/);
    assert.equal((await first.state()).current, ids.Atlas);
  });

  it('a second start with a link opens it; a link of another form is refused and nothing opens', T, async () => {
    await secondStart([link(ids.Beacon)]);
    assert.ok(await until(async () => (await tabIds(first)).includes(ids.Beacon), 15_000), js(await first.state()));
    const before = await tabIds(first);
    await secondStart([`open-artifact://artifact/${ids.Cobalt}/extra`, `open-artifact://type/docs`]);
    await first.line(new RegExp(`link refused \\(second start\\): open-artifact://artifact/${ids.Cobalt}/extra`));
    await first.line(/link refused \(second start\): open-artifact:\/\/type\/docs/);
    assert.deepEqual(await tabIds(first), before, 'a refused link opened something');
  });

  it('macOS\'s open-url and the named command open-url take the same links and refuse the rest', T, async () => {
    assert.equal(await first.chrome.evaluate(`desktop.test.openUrl(${js(link(ids.Cobalt))})`), true);
    assert.ok(await until(async () => (await tabIds(first)).includes(ids.Cobalt), 15_000));
    await first.line(new RegExp(`link \\(open-url\\): ${ids.Cobalt}`));
    const out = await first.command('open-url', link(ids.Dune));
    assert.equal(out.ok, true, js(out));
    assert.ok(await until(async () => (await tabIds(first)).includes(ids.Dune), 15_000));
    await first.line(new RegExp(`link \\(command\\): ${ids.Dune}`));

    const before = await tabIds(first);
    for (const bad of [`https://example.com/artifact/${ids.Ember}`, `open-artifact://artifact/${ids.Ember}?x=1`, 'open-artifact://artifact/../../etc', 'open-artifact://']) {
      assert.equal(await first.chrome.evaluate(`desktop.test.openUrl(${js(bad)})`), false, bad);
      await first.line(new RegExp(`link refused \\(open-url\\): ${bad.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
    }
    assert.deepEqual(await tabIds(first), before, 'a refused link opened something');
  });

  it('two apps in different homes run at the same time', T, async () => {
    elsewhere = await launchApp(other, otherPort);
    await elsewhere.line(/\[desktop\] ready /);
    await elsewhere.connect();
    assert.equal(elsewhere.exited, null);
    assert.equal(first.exited, null);
    assert.notEqual(daemonState(other).pid, daemonState(profile).pid);
    assert.equal(elsewhere.lines.some((l) => /another instance runs/.test(l)), false);
    assert.equal(first.lines.some((l) => /second start: .*oa-desktop-instance-b-/.test(l)), false, 'the other home reached the first app');
    await elsewhere.quit();
    elsewhere = null;
  });

  it('a link as a start\'s argument opens its artifact; nothing registers the scheme', T, async () => {
    await first.quit({ force: true });
    first = await launchApp(profile, port, { args: [link(ids.Ember), 'open-artifact://nope', '--open', ids.Fjord] });
    await first.line(/\[desktop\] ready /);
    await first.connect();
    assert.ok(await until(async () => {
      const open = await tabIds(first);
      return open.includes(ids.Ember) && open.includes(ids.Fjord);
    }, 20_000), js(await first.state()));
    await first.line(/link refused \(arguments\): open-artifact:\/\/nope/);
    assert.equal(first.lines.some((l) => /protocol client|lsregister|registered .*open-artifact/i.test(l)), false);
  });
});

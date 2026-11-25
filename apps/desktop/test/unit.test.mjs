/**
 * The app's decisions that need no Electron: the profile and its guards (profile.mjs), the origin allowlist and what a
 * view's navigation does (navigation.mjs), back and forward over tabs (history.mjs), the window's own settings
 * (settings.mjs), and what the home page may ask of the Library API (library.mjs).
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { TabHistory } from '../src/history.mjs';
import { LibraryError, createArg, idArg, libraryClient, patchArg, startsBlank } from '../src/library.mjs';
import { Settings, chromiumLang } from '../src/settings.mjs';
import { daemonEnv, daemonOnDefaultPort, resolveProfile } from '../src/profile.mjs';
import { OriginAllowlist, decide, shellArtifactId, subframeAllowed } from '../src/navigation.mjs';

const user = '/Users/someone';

describe('profile', () => {
  const dev = (argv, env = {}) => resolveProfile({ argv, env, packaged: false, userHome: user, accountHome: user });

  it('a development run with a home and a port of its own starts, with Electron\'s folders under the home', () => {
    const profile = dev(['--home', '/tmp/p/oa', '--port', '4891']);
    assert.deepEqual(profile.problems, []);
    assert.equal(profile.home, '/tmp/p/oa');
    assert.equal(profile.port, 4891);
    assert.deepEqual(profile.paths, {
      userData: '/tmp/p/oa/desktop/user-data',
      sessionData: '/tmp/p/oa/desktop/session',
      logs: '/tmp/p/oa/desktop/logs',
      crashDumps: '/tmp/p/oa/desktop/crash-dumps',
    });
  });

  it('takes the home and the port from the environment too; arguments win', () => {
    assert.equal(dev([], { OPEN_ARTIFACT_HOME: '/tmp/e', OPEN_ARTIFACT_PORT: '4892' }).home, '/tmp/e');
    assert.equal(dev(['--home=/tmp/a', '--port=4893'], { OPEN_ARTIFACT_HOME: '/tmp/e', OPEN_ARTIFACT_PORT: '4892' }).port, 4893);
    assert.equal(dev(['--home=/tmp/a', '--port=4893'], { OPEN_ARTIFACT_HOME: '/tmp/e' }).home, '/tmp/a');
  });

  it('a development run refuses the default home, under HOME or under the account\'s real home', () => {
    assert.match(dev(['--port', '4891']).problems.join(' '), /default home/);
    assert.match(dev(['--home', '~/.agents/open-artifact', '--port', '4891']).problems.join(' '), /default home/);
    const elsewhere = resolveProfile({ argv: ['--home', `${user}/.agents/open-artifact`, '--port', '4891'], packaged: false, userHome: '/tmp/fake-home', accountHome: user });
    assert.match(elsewhere.problems.join(' '), /default home/);
  });

  it('a development run refuses port 4800, and no port at all', () => {
    assert.match(dev(['--home', '/tmp/p', '--port', '4800']).problems.join(' '), /4800/);
    assert.match(dev(['--home', '/tmp/p'], { OPEN_ARTIFACT_PORT: '4800' }).problems.join(' '), /4800/);
    assert.match(dev(['--home', '/tmp/p']).problems.join(' '), /needs a port/);
    assert.match(dev(['--home', '/tmp/p', '--port', 'abc']).problems.join(' '), /not a port/);
  });

  it('a packaged app runs on the default home and port, with Electron\'s own folders', () => {
    const profile = resolveProfile({ argv: [], env: {}, packaged: true, userHome: user, accountHome: user });
    assert.deepEqual(profile.problems, []);
    assert.equal(profile.home, `${user}/.agents/open-artifact`);
    assert.equal(profile.paths, null);
  });

  it('DevTools only in test mode; --open collects artifacts', () => {
    assert.match(dev(['--home', '/tmp/p', '--port', '4891', '--devtools-port', '9333']).problems.join(' '), /test mode/);
    const test = dev(['--home', '/tmp/p', '--port', '4891', '--test-mode', '--devtools-port', '9333', '--open', 'art_a', '--open=art_b']);
    assert.deepEqual(test.problems, []);
    assert.equal(test.debugPort, 9333);
    assert.deepEqual(test.open, ['art_a', 'art_b']);
  });

  it('a daemon on 4800 is recognised from its daemon.json', () => {
    assert.equal(daemonOnDefaultPort({ url: 'http://127.0.0.1:4800' }), true);
    assert.equal(daemonOnDefaultPort({ url: 'http://127.0.0.1:4891' }), false);
    assert.equal(daemonOnDefaultPort(null), false);
  });

  it('the daemon starts with the profile\'s home and port, without another daemon\'s entry or an agent\'s session', () => {
    const env = daemonEnv({ PATH: '/bin', OPEN_ARTIFACT_DAEMON_BIN: '/x', OPEN_ARTIFACT_SESSION: 's', OPEN_ARTIFACT_HARNESS: 'h', ELECTRON_RUN_AS_NODE: '1', OA_DESKTOP_TEST: '1' }, { home: '/tmp/p', port: 4891 });
    assert.deepEqual(env, { PATH: '/bin', OPEN_ARTIFACT_HOME: '/tmp/p', OPEN_ARTIFACT_PORT: '4891' });
  });
});

describe('navigation', () => {
  const allowlist = new OriginAllowlist();
  allowlist.setDaemon('http://127.0.0.1:4891');
  allowlist.fromDaemon({
    origins: [],
    entries: [{ origin: 'http://127.0.0.1:5001' }, { pattern: 'http://*.frame.localhost:4891' }, { origin: 'https://remote.example', remote: true }],
  });
  const current = 'art_one';

  it('allows exactly the daemon and the listed local origins', () => {
    assert.equal(allowlist.allows('http://127.0.0.1:4891/a/x'), true);
    assert.equal(allowlist.allows('http://127.0.0.1:5001/docs/'), true);
    assert.equal(allowlist.allows('http://art1.frame.localhost:4891/'), true);
    assert.equal(allowlist.allows('http://frame.localhost:4891/'), false);
    assert.equal(allowlist.allows('http://127.0.0.1:5002/'), false, 'not all of loopback');
    assert.equal(allowlist.allows('https://remote.example/'), false, 'remote pages are not shown');
    assert.equal(allowlist.allows('file:///etc/passwd'), false);
  });

  it('the same artifact stays; another artifact opens a tab; the home page goes to the first tab', () => {
    assert.deepEqual(decide('http://127.0.0.1:4891/a/art_one?x=1#p', { allowlist, current }), { action: 'allow' });
    assert.deepEqual(decide('http://127.0.0.1:4891/a/art_two?oa_view=t', { allowlist, current }), { action: 'open-tab', id: 'art_two' });
    assert.deepEqual(decide('http://127.0.0.1:5001/a/art_three', { allowlist, current }), { action: 'open-tab', id: 'art_three' });
    assert.deepEqual(decide('http://127.0.0.1:4891/', { allowlist, current }), { action: 'home' });
    assert.deepEqual(decide('http://127.0.0.1:4891/?tab=types', { allowlist, current }), { action: 'home' });
  });

  it('other pages of allowed origins are blocked; the web goes to the system browser; the rest is blocked', () => {
    assert.deepEqual(decide('http://127.0.0.1:4891/types', { allowlist, current }), { action: 'block' });
    assert.deepEqual(decide('http://127.0.0.1:5001/', { allowlist, current }), { action: 'block' });
    assert.deepEqual(decide('https://example.com/x', { allowlist, current }), { action: 'external', url: 'https://example.com/x' });
    assert.deepEqual(decide('http://127.0.0.1:5002/', { allowlist, current }), { action: 'external', url: 'http://127.0.0.1:5002/' });
    assert.deepEqual(decide('file:///etc/passwd', { allowlist, current }), { action: 'block' });
    assert.deepEqual(decide('javascript:alert(1)', { allowlist, current }), { action: 'block' });
    assert.deepEqual(decide('not a url', { allowlist, current }), { action: 'block' });
  });

  it('subframes: the page\'s own and allowed origins only', () => {
    assert.equal(subframeAllowed('blob:http://127.0.0.1:5001/1234', allowlist), true);
    assert.equal(subframeAllowed('about:srcdoc', allowlist), true);
    assert.equal(subframeAllowed('http://127.0.0.1:5001/docs/', allowlist), true);
    assert.equal(subframeAllowed('https://example.com/', allowlist), false);
  });

  it('reads the artifact id of a Shell address', () => {
    assert.equal(shellArtifactId('http://127.0.0.1:4891/a/art_x%20y?z'), 'art_x y');
    assert.equal(shellArtifactId('http://127.0.0.1:4891/b/art_x'), null);
  });
});

describe('profile: test-mode looks', () => {
  const dev = (argv) => resolveProfile({ argv: ['--home', '/tmp/p', '--port', '4891', ...argv], env: {}, packaged: false, userHome: user, accountHome: user });

  it('--locale, --theme and --thumbnails only in test mode, with known values', () => {
    const test = dev(['--test-mode', '--locale', 'zh', '--theme', 'dark', '--thumbnails']);
    assert.deepEqual(test.problems, []);
    assert.deepEqual([test.locale, test.theme, test.thumbnails], ['zh', 'dark', true]);
    const plain = dev(['--test-mode']);
    assert.deepEqual([plain.locale, plain.theme, plain.thumbnails], [null, null, false]);
    for (const flag of [['--locale', 'en'], ['--theme', 'light'], ['--thumbnails']]) {
      assert.match(dev(flag).problems.join(' '), /test mode only/, flag.join(' '));
    }
    assert.match(dev(['--test-mode', '--locale', 'fr']).problems.join(' '), /en or zh/);
    assert.match(dev(['--test-mode', '--theme', 'sepia']).problems.join(' '), /light or dark/);
  });
});

describe('tab history', () => {
  it('goes back and forward like a browser; a visit after going back drops what was ahead', () => {
    const h = new TabHistory('home');
    assert.equal(h.canBack, false);
    h.visit('a');
    h.visit('b');
    h.visit('b');
    assert.deepEqual(h.entries, ['home', 'a', 'b']);
    assert.equal(h.back(), 'a');
    assert.equal(h.back(), 'home');
    assert.equal(h.back(), null);
    assert.equal(h.forward(), 'a');
    h.visit('c');
    assert.deepEqual(h.entries, ['home', 'a', 'c']);
    assert.equal(h.canForward, false);
    assert.equal(h.forward(), null);
  });

  it('a closed tab\'s entries go, and two same entries that then meet become one', () => {
    const h = new TabHistory('home');
    for (const id of ['a', 'b', 'a', 'c']) h.visit(id);
    h.remove('b');
    assert.deepEqual(h.entries, ['home', 'a', 'c']);
    assert.equal(h.current, 'c');
    h.back();
    h.remove('a');
    assert.deepEqual(h.entries, ['home', 'c']);
    assert.equal(h.current, 'home');
    h.remove('home', 'home');
    h.remove('c', 'home');
    assert.deepEqual(h.entries, ['home']);
  });
});

describe('settings', () => {
  it('keeps the sidebar\'s state in settings.json, refuses what is not a setting, and starts from defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-desktop-settings-'));
    try {
      const first = new Settings(dir);
      assert.equal(first.get('sidebarCollapsed'), false);
      first.set('sidebarCollapsed', true);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), { sidebarCollapsed: true, theme: 'system', locale: 'system', artifactsFolder: '' });
      assert.equal(new Settings(dir).get('sidebarCollapsed'), true);
      assert.throws(() => first.set('sidebarCollapsed', 'yes'), /not a setting/);
      assert.throws(() => first.set('token', 'x'), /not a setting/);
      writeFileSync(join(dir, 'settings.json'), '{ not json');
      assert.equal(new Settings(dir).get('sidebarCollapsed'), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the look and the language: only their choices, kept, and a stored value that is not one is the default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-desktop-settings-'));
    try {
      const first = new Settings(dir);
      assert.deepEqual([first.get('theme'), first.get('locale')], ['system', 'system']);
      first.set('theme', 'dark');
      first.set('locale', 'zh-CN');
      assert.deepEqual([new Settings(dir).get('theme'), new Settings(dir).get('locale')], ['dark', 'zh-CN']);
      for (const [name, value] of [['theme', 'blue'], ['theme', true], ['locale', 'zh'], ['locale', 'fr'], ['locale', '']]) {
        assert.throws(() => first.set(name, value), /not a setting/, `${name} = ${value}`);
      }
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sidebarCollapsed: true, theme: 'sepia', locale: 'de' }));
      const read = new Settings(dir);
      assert.deepEqual([read.get('sidebarCollapsed'), read.get('theme'), read.get('locale')], [true, 'system', 'system']);
      // Chromium's --lang: none for the system's language.
      assert.deepEqual(['system', 'en', 'zh-CN', 'zh'].map(chromiumLang), [null, 'en-US', 'zh-CN', 'zh-CN']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('what the home page may ask', () => {
  it('ids are artifact ids, exactly', () => {
    assert.equal(idArg('art_abc'), 'art_abc');
    for (const bad of ['../daemon.json', 'open-artifact://artifact/art_a', '', 7, null, 'a b']) assert.throws(() => idArg(bad), LibraryError, String(bad));
  });

  it('a change is a title or pinned, nothing else', () => {
    assert.deepEqual(patchArg({ title: '  Ferry  ', pinned: true }), { title: 'Ferry', pinned: true });
    for (const bad of [{ owner: 'x' }, { title: '' }, { title: 'x'.repeat(301) }, { pinned: 'yes' }, {}, [], null]) {
      assert.throws(() => patchArg(bad), LibraryError, JSON.stringify(bad));
    }
  });

  it('a new artifact is a type id and a title; the built-in groups say which start blank', () => {
    assert.deepEqual(createArg({ type: 'docs', title: '  Notes ' }), { type: 'docs', title: 'Notes' });
    assert.deepEqual(createArg({ type: 'design' }), { type: 'design', title: '' });
    for (const bad of [{ type: '../x' }, { type: '' }, { type: 3 }, null]) assert.throws(() => createArg(bad), LibraryError, JSON.stringify(bad));
    assert.deepEqual(['docs', 'sheets', 'whiteboard', 'slides', 'design-system'].map(startsBlank), [true, true, true, true, true]);
    assert.deepEqual(['design', 'data', 'motion', 'page', 'my-type'].map(startsBlank), [false, false, false, false, false]);
  });

  it('the client sends the token itself and throws with the daemon\'s words; without a connection it sends nothing', async () => {
    const sent = [];
    const fetchImpl = async (url, init) => {
      sent.push({ url: String(url), auth: init.headers.Authorization, method: init.method, body: init.body });
      return new Response(JSON.stringify({ code: 'not_found', message: 'no such artifact' }), { status: 404, headers: { 'content-type': 'application/json' } });
    };
    const client = libraryClient({ state: () => ({ url: 'http://127.0.0.1:4891', token: 'secret' }), fetchImpl });
    await assert.rejects(client.update('art_a', { title: 'x' }), /no such artifact/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].auth, 'Bearer secret');
    assert.match(sent[0].url, /^http:\/\/127\.0\.0\.1:4891\/api\/open-artifact\./);
    const offline = libraryClient({ state: () => null, fetchImpl });
    await assert.rejects(offline.list(), /not connected/);
    assert.equal(sent.length, 1);
  });
});

describe('the service panel and the runtime, as the page is sent them', async () => {
  const { appsView, daemonView, doctorView, serversView } = await import('../src/service.mjs');
  const { newer, statusView } = await import('../src/runtime.mjs');
  const { newArtifactFolder, slugify } = await import('../src/folders.mjs');
  const { validSetting } = await import('../src/settings.mjs');

  it('the daemon is picked field by field: never its token', () => {
    const state = { url: 'http://127.0.0.1:4891', port: 4891, pid: 12, token: 'secret-token', version: '0.14.6', startedAt: '2026-11-25T00:00:00Z', extra: 'x' };
    const view = daemonView(state);
    assert.deepEqual(view, { version: '0.14.6', address: '127.0.0.1:4891', port: 4891, pid: 12, startedAt: '2026-11-25T00:00:00Z' });
    assert.equal(JSON.stringify(view).includes('secret-token'), false);
    assert.equal(daemonView(null), null);
  });

  it('the apps connected: one row per connection, this one marked, sessions counted', () => {
    const answer = {
      harnesses: [{ name: 'claude-code', title: 'Claude Code', token: 'no' }],
      adapters: [
        { id: 'c1', harness: 'open-artifact-desktop', sessions: [] },
        { id: 'c2', harness: 'claude-code', sessions: [{ id: 's1' }, { id: 's2' }], polling: true, token: 'no' },
        { harness: 'broken' },
      ],
    };
    assert.deepEqual(appsView(answer, 'c1'), [
      { connection: 'c1', harness: 'open-artifact-desktop', title: 'open-artifact-desktop', sessions: 0, polling: false, self: true },
      { connection: 'c2', harness: 'claude-code', title: 'Claude Code', sessions: 2, polling: true, self: false },
    ]);
    assert.deepEqual(serversView({ servers: [{ type: 'docs', state: 'running', pid: 7, restarts: 1, port: 1, secret: 'x' }] }), [{ type: 'docs', state: 'running', pid: 7, restarts: 1, error: null }]);
    assert.deepEqual(doctorView({ ok: true, counts: { ok: 1 }, findings: [{ id: 'a', status: 'ok', message: 'fine', env: 'x' }] }), {
      ok: true,
      findings: [{ id: 'a', status: 'ok', message: 'fine' }],
      counts: { ok: 1, warn: 0, fail: 0, 'n/a': 0 },
    });
  });

  it('runtime versions compare as x.y.z, a pre-release before its release; the status is picked', () => {
    assert.equal(newer('0.15.0', '0.14.6'), true);
    assert.equal(newer('0.14.6', '0.14.6'), false);
    assert.equal(newer('0.14.10', '0.14.9'), true);
    assert.equal(newer('0.15.0-rc.1', '0.15.0'), false);
    assert.equal(newer('0.15.0', '0.15.0-rc.1'), true);
    const view = statusView({ running: '0.14.6', policy: { update: 'prompt', source: 'adapter' }, check: { at: 't', available: 'not a version' }, pending: '0.15.0', token: 'x' });
    assert.deepEqual(view, { running: '0.14.6', selected: null, policy: { update: 'prompt', source: 'adapter' }, pin: null, check: { at: 't', available: null, error: null }, pending: '0.15.0' });
  });

  it('the folder for new artifacts: an absolute folder or the default; names as the daemon makes them', () => {
    assert.equal(validSetting('artifactsFolder', ''), true);
    assert.equal(validSetting('artifactsFolder', '/Users/someone/Work'), true);
    assert.equal(validSetting('artifactsFolder', 'relative/path'), false);
    assert.equal(validSetting('artifactsFolder', '/a/../b'), false);
    assert.equal(validSetting('artifactsFolder', '/a\0b'), false);
    assert.equal(validSetting('artifactsFolder', 7), false);
    assert.equal(slugify('Tide Tables, 2027!'), 'tide-tables-2027');
    assert.equal(slugify('渡轮笔记'), '渡轮笔记');
    assert.equal(slugify('Café'), 'cafe');
    assert.equal(slugify('!!!'), 'artifact');
    const base = mkdtempSync(join(tmpdir(), 'oa-unit-folders-'));
    try {
      assert.equal(newArtifactFolder(base, 'Ferry'), join(base, 'ferry'));
      // An empty folder of that name is used; one with something in it is not.
      mkdirSync(join(base, 'ferry'));
      assert.equal(newArtifactFolder(base, 'Ferry'), join(base, 'ferry'));
      writeFileSync(join(base, 'ferry', 'x'), '');
      assert.equal(newArtifactFolder(base, 'Ferry'), join(base, 'ferry-2'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
